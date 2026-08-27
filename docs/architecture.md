# Architecture

The coordinator is the authority for projects, nodes, runs, approvals, reports, ideas, artifacts, portfolio views, allowance, and event streams. Workers never receive reusable external-action authority: an approval is scoped, expires, and is atomically consumed once.

`run_events` is append-only at the database layer. Reports cite event IDs, artifacts, commits, timestamps, and hashes so output can be regenerated and checked. Workers use isolated Git worktrees rooted in the configured data directory.

The subscription guard reads locally reported allowance state. Available or limited allowance queues a run; exhausted or unknown allowance places it in `waiting_for_allowance`. No fallback provider exists. Workers launch the locally authenticated `codex` executable with `OPENAI_API_KEY` removed from the child environment.

Voice is local-only: `whisper.cpp` transcribes, Piper speaks, and openWakeWord detects the activation phrase. The HTTP and WebSocket boundaries return unavailable until those local daemons are configured; they never proxy to a cloud speech API.

The investment ledger is ingestion-backed and read-only through the API. Currency values retain their original ISO 4217 currency; conversion and performance reporting must record the FX source and timestamp.

