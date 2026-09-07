import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";
import {
  AllowanceState,
  ArtifactKind,
  CommissionClaim,
  CommissionCompletion,
  CommissionLeaseRenewal,
  COMMISSION_LEASE_DURATION_MS,
  DispatchRunPayload,
  MAX_ARTIFACT_BODY_CHARS,
  NodeHeartbeat,
  NodeId,
  NodePlatform,
  RunState
} from "@ordis/shared";

const execFileAsync = promisify(execFile);
if (process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is forbidden; authenticate the local Codex CLI with ChatGPT Plus");
const coordinator = process.env.ORDIS_COORDINATOR_URL ?? "http://127.0.0.1:4310";
const nodeId = NodeId.parse(process.env.ORDIS_NODE_ID ?? randomUUID());
const token = process.env.ORDIS_SESSION_TOKEN;
const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
const startupRetryBaseMs = 1_000;
const startupRetryMaxMs = 15_000;
const commissionPollMs = 5_000;
const maxChronicleOutputChars = 65_536;
const executionEnabled = process.env.ORDIS_HAND_EXECUTION_ENABLED === "true";
let activeRuns = 0;
let executing = false;

export function runCodexInWorktree(prompt: string, worktree: string) {
  return spawn("codex", ["exec", "--json", "--cd", worktree, prompt], {
    stdio: ["ignore", "pipe", "pipe"],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "OPENAI_API_KEY"))
  });
}

async function resolveGitWorktree(repositoryPath: string) {
  const candidate = await realpath(repositoryPath);
  const { stdout } = await execFileAsync("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
  return realpath(stdout.trim());
}

function waitForExit(child: ReturnType<typeof runCodexInWorktree>) {
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const collect = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
    const value = chunk.toString();
    const current = stream === "stdout" ? stdout : stderr;
    const remaining = maxChronicleOutputChars - current.length;
    if (remaining <= 0) { truncated = true; return; }
    const next = current + value.slice(0, remaining);
    if (value.length > remaining) truncated = true;
    if (stream === "stdout") stdout = next; else stderr = next;
  };
  child.stdout?.on("data", (chunk) => collect(chunk, "stdout"));
  child.stderr?.on("data", (chunk) => collect(chunk, "stderr"));
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; truncated: boolean }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr, truncated }));
  });
}

async function heartbeat() {
  const body = NodeHeartbeat.parse({
    nodeId,
    platform: platform() === "win32" ? NodePlatform.enum.windows : NodePlatform.enum.arch,
    capabilities: ["codex-cli", "git-worktrees", "local-artifacts"],
    activeRuns,
    allowance: AllowanceState.parse(process.env.ORDIS_ALLOWANCE_STATE ?? AllowanceState.enum.unknown),
    observedAt: new Date().toISOString()
  });
  const response = await fetch(`${coordinator}/api/nodes/heartbeat`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`heartbeat failed: ${response.status}`);
}

async function waitForCoordinator() {
  let attempts = 0;
  for (;;) {
    try {
      await heartbeat();
      return;
    } catch (error) {
      attempts += 1;
      const delayMs = Math.min(startupRetryBaseMs * 2 ** (attempts - 1), startupRetryMaxMs);
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`The Helm is unavailable (${reason}); retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function completeClaim(claim: CommissionClaim, state: RunState, exitCode: number | null) {
  const response = await fetch(`${coordinator}/api/runs/${claim.run.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ nodeId, state, exitCode })
  });
  if (!response.ok) throw new Error(`commission completion failed: ${response.status}`);
  CommissionCompletion.parse(await response.json());
}

async function recordOutput(claim: CommissionClaim, stdout: string, stderr: string, truncated: boolean) {
  const response = await fetch(`${coordinator}/api/runs/${claim.run.id}/output`, {
    method: "POST", headers, body: JSON.stringify({ nodeId, stdout, stderr, truncated })
  });
  if (!response.ok) throw new Error(`commission output failed: ${response.status}`);
}

async function renewLease(claim: CommissionClaim) {
  const response = await fetch(`${coordinator}/api/runs/${claim.run.id}/lease`, {
    method: "POST", headers, body: JSON.stringify({ nodeId })
  });
  if (!response.ok) throw new Error(`commission lease renewal failed: ${response.status}`);
  CommissionLeaseRenewal.parse(await response.json());
}

async function recordWorkpiece(claim: CommissionClaim, worktree: string) {
  let body: string;
  try {
    const [{ stdout: status }, { stdout: patch }] = await Promise.all([
      execFileAsync("git", ["-C", worktree, "status", "--short"]),
      execFileAsync("git", ["-C", worktree, "diff", "--binary", "--no-ext-diff"], {
        maxBuffer: MAX_ARTIFACT_BODY_CHARS - 4096
      })
    ]);
    body = JSON.stringify({ status: status.trimEnd(), patch }, null, 2);
  } catch (error) {
    body = JSON.stringify({ capture: "unavailable", reason: error instanceof Error ? error.message : String(error) });
  }
  const response = await fetch(`${coordinator}/api/runs/${claim.run.id}/artifacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      nodeId,
      kind: ArtifactKind.enum.workpiece,
      label: "Git workpiece snapshot",
      mediaType: "application/json",
      body,
      sha256: createHash("sha256").update(body).digest("hex")
    })
  });
  if (!response.ok) throw new Error(`commission artifact failed: ${response.status}`);
}

async function pollCommission() {
  if (!executionEnabled || executing) return;
  const response = await fetch(`${coordinator}/api/hands/${nodeId}/claim`, { method: "POST", headers });
  if (response.status === 204) return;
  if (!response.ok) throw new Error(`commission claim failed: ${response.status}`);

  const claim = CommissionClaim.parse(await response.json());
  const payload = DispatchRunPayload.parse(claim.run.payload);
  executing = true;
  activeRuns = 1;
  let leaseTimer: ReturnType<typeof setInterval> | undefined;
  await heartbeat();
  try {
    const worktree = await resolveGitWorktree(claim.project.repositoryPath);
    console.log(`Executing Commission ${claim.run.id} in ${worktree}`);
    leaseTimer = setInterval(() => renewLease(claim).catch((error) => console.error(error)), Math.floor(COMMISSION_LEASE_DURATION_MS / 3));
    const result = await waitForExit(runCodexInWorktree(payload.objective, worktree));
    clearInterval(leaseTimer);
    leaseTimer = undefined;
    await recordOutput(claim, result.stdout, result.stderr, result.truncated);
    await recordWorkpiece(claim, worktree);
    await completeClaim(claim, result.exitCode === 0 ? RunState.enum.succeeded : RunState.enum.failed, result.exitCode);
  } catch (error) {
    console.error(`Commission ${claim.run.id} failed`, error);
    try {
      await completeClaim(claim, RunState.enum.failed, null);
    } catch (completionError) {
      console.error(`Unable to record failure for Commission ${claim.run.id}`, completionError);
    }
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    activeRuns = 0;
    executing = false;
    await heartbeat();
  }
}

await waitForCoordinator();
setInterval(() => heartbeat().catch((error) => console.error(error)), 15_000);
if (executionEnabled) {
  console.log(`Ordis Hand ${nodeId} online; execution is enabled for assigned Commissions only`);
  await pollCommission();
  setInterval(() => pollCommission().catch((error) => console.error(error)), commissionPollMs);
} else {
  console.log(`Ordis Hand ${nodeId} online; set ORDIS_HAND_EXECUTION_ENABLED=true to execute assigned Commissions`);
}
