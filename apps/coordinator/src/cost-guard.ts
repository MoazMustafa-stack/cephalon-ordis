import type { CostGuardState } from "@ordis/shared";

export function readCostGuard(env: NodeJS.ProcessEnv = process.env): CostGuardState {
  if (env.OPENAI_API_KEY) {
    throw new Error("Cephalon Ordis forbids OPENAI_API_KEY; use a locally authenticated Codex CLI session");
  }
  const allowance = env.ORDIS_ALLOWANCE_STATE ?? "unknown";
  if (!["available", "limited", "exhausted", "unknown"].includes(allowance)) {
    throw new Error(`Invalid ORDIS_ALLOWANCE_STATE: ${allowance}`);
  }
  return {
    mode: "subscription-only",
    allowance: allowance as CostGuardState["allowance"],
    directApiEnabled: false,
    checkedAt: new Date().toISOString(),
    reason: allowance === "exhausted" ? "Local Codex allowance is exhausted" : undefined
  };
}

export function initialRunState(guard: CostGuardState) {
  return guard.allowance === "available" || guard.allowance === "limited"
    ? "queued" as const
    : "waiting_for_allowance" as const;
}
