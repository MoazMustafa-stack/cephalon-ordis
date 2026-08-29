import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { NodeHeartbeat } from "@ordis/shared";

if (process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is forbidden; authenticate the local Codex CLI with ChatGPT Plus");
const coordinator = process.env.ORDIS_COORDINATOR_URL ?? "http://127.0.0.1:4310";
const nodeId = process.env.ORDIS_NODE_ID ?? randomUUID();
const token = process.env.ORDIS_SESSION_TOKEN;
const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
const startupRetryBaseMs = 1_000;
const startupRetryMaxMs = 15_000;

export function runCodexInWorktree(prompt: string, worktree: string) {
  return spawn("codex", ["exec", "--json", "--cd", worktree, prompt], {
    stdio: ["ignore", "pipe", "pipe"],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "OPENAI_API_KEY"))
  });
}

async function heartbeat() {
  const body: NodeHeartbeat = {
    nodeId,
    platform: platform() === "win32" ? "windows" : "arch",
    capabilities: ["codex-cli", "git-worktrees", "local-artifacts"],
    activeRuns: 0,
    allowance: (process.env.ORDIS_ALLOWANCE_STATE as NodeHeartbeat["allowance"]) ?? "unknown",
    observedAt: new Date().toISOString()
  };
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

await waitForCoordinator();
setInterval(() => heartbeat().catch((error) => console.error(error)), 15_000);
console.log(`Ordis Hand ${nodeId} online; local Codex CLI execution only`);
