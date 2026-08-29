import { AllowanceState, CostGuardState, RunState } from "@ordis/shared";

export function readCostGuard(env: NodeJS.ProcessEnv = process.env): CostGuardState {
  if (env.OPENAI_API_KEY) {
    throw new Error("Cephalon Ordis forbids OPENAI_API_KEY; use a locally authenticated Codex CLI session");
  }
  const allowance = AllowanceState.parse(env.ORDIS_ALLOWANCE_STATE ?? AllowanceState.enum.unknown);
  return CostGuardState.parse({
    mode: "subscription-only",
    allowance,
    directApiEnabled: false,
    checkedAt: new Date().toISOString(),
    reason: allowance === AllowanceState.enum.exhausted ? "Local Codex allowance is exhausted" : undefined
  });
}

export function initialRunState(guard: CostGuardState): RunState {
  return guard.allowance === AllowanceState.enum.available || guard.allowance === AllowanceState.enum.limited
    ? RunState.enum.queued
    : RunState.enum.waiting_for_allowance;
}
