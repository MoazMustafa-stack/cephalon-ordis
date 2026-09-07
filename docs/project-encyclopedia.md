# Cephalon Ordis: Project Encyclopedia

This document is the human-facing explanation of Cephalon Ordis. It is
deliberately separate from the private agent context vault at
E:/Cephalon-Ordis/brain. The vault contains operational memory and decisions
for agents; this document explains the product for people.

## What the project is

Cephalon Ordis is a private, local-first command center for planning and
coordinating work through locally authenticated Codex CLI sessions. It is not
another language model and it does not call the OpenAI API directly. Codex is
the coding and reasoning engine; Ordis is the control plane around it.

The long-term goal is a personal operations system that can turn objectives
into structured work, assign that work to local workers, require approval for
consequential actions, show progress and evidence, recover failed work, and
retain durable project memory.

## What it does today

The working local vertical slice is:

    Chart -> Dispatch -> Hand -> Chronicle -> Observatory

1. Register a project and its Git repository.
2. Chart an objective into a planned Thread.
3. Dispatch the Thread to a fresh, available Hand.
4. Let the assigned Hand claim the Commission.
5. Optionally execute the objective with the local Codex CLI.
6. Record lifecycle events, bounded output, Workpiece artifacts, and Reports.
7. Inspect the run and evidence in the Observatory.

Codex execution is opt-in through ORDIS_HAND_EXECUTION_ENABLED=true. The
normal development worker remains observational until the operator enables it.

## Product language

The interface uses original terms with plain meanings:

| Ordis term | Technical meaning |
| --- | --- |
| Lattice | Embedded technology layer |
| Thread | Planned workflow |
| Helm | Coordinator |
| Hand | Worker node |
| Commission | Job or run |
| Harbor | Queue |
| Pulse | Heartbeat |
| Seal | Approval |
| Chronicle | Append-only event history |
| Workpiece | Persisted execution artifact |
| Constellation | Idea graph |
| Reserve | Subscription allowance |
| Observatory | Dashboard |

The main operations are Chart, Dispatch, Survey, Forge, Convene, Seal,
Distill, Chronicle, Recall, and Berth. Technical names remain in code and API
routes when that is clearer.

## Architecture

    Operator
      -> Observatory: SvelteKit PWA
      -> Helm: Fastify coordinator
      -> PostgreSQL: state and evidence
      -> Hand: heartbeat, claim, lease, execution
      -> local Codex CLI
      -> registered Git worktree

| Component | Source directory | Role |
| --- | --- | --- |
| Observatory | apps/web | Local dashboard and realtime event view |
| Helm | apps/coordinator | API, transitions, validation, dispatch, persistence |
| Hand | apps/worker | Pulse, claim polling, Codex execution, evidence capture |
| Lattice | packages/shared | Canonical Zod schemas, branded IDs, enums, policies |
| Ordis MCP | packages/ordis-mcp | Local MCP integration foundation |
| Companion | apps/companion | Tauri/Rust desktop foundation |
| Database | db/migrations | PostgreSQL schema and incremental migrations |
| Launcher | scripts/start-dev.ps1 | Reliable Windows startup |
| Verifier | scripts/verify.ps1 | Tests, typechecks, lint, builds, audits |

## Commission lifecycle

### Chart

Chart accepts a project and objective and creates a planned Thread. It does not
execute anything.

### Dispatch

Dispatch atomically chooses a fresh, idle Hand whose allowance is eligible,
marks the Thread dispatched, creates a queued Run, and records
commission.dispatched. If no Hand qualifies, the Thread stays planned.

### Claim

The assigned Hand polls for work. Claim checks the Hand Pulse, recovers expired
claims, increments the attempt, sets a renewable 60-second lease, marks the Run
claimed, and records commission.claimed.

### Execute

When enabled, the Hand resolves the registered repository, verifies it is a
real Git worktree, and invokes the locally authenticated Codex CLI. No direct
API key is used.

### Lease and recovery

Each claimed Commission has at most three attempts. The Hand renews its lease
while execution runs. If a terminal or machine disappears, a later claim
notices the expired lease and:

- requeues and unassigns the Commission while attempts remain;
- marks it failed at the attempt limit;
- records commission.lease_expired.

An expired Hand cannot later submit output or completion.

### Evidence

stdout and stderr are each capped at 64 KiB and stored as Chronicle evidence.
The Hand also captures a bounded Git Workpiece snapshot through a controlled
artifact endpoint. Artifacts use generated IDs; callers cannot provide
arbitrary filesystem paths.

### Completion, cancellation, and retry

A zero Codex exit code succeeds; another exit code fails. Active work can be
cancelled with a reason. Failed work can be retried while the attempt limit
allows. These actions append commission.cancelled or commission.retried events.

### Chronicle and Reports

Chronicle is append-only. Distill creates one canonical Report JSON document
in reports.body and references Chronicle events by stable evidence URIs.

## Data model

- Projects are registered repository roots.
- Threads are project-scoped objectives.
- Runs are Commissions with state, payload, assignment, lease, and attempts.
- Nodes are Hands with capabilities, allowance, active count, and last Pulse.
- Run events are immutable lifecycle and evidence records.
- Artifacts are controlled Workpiece or execution documents.
- Reports store the complete canonical Report JSON document.
- Approval requests are the future Seal workflow.
- Idea graphs and portfolio transactions are later product surfaces.

The migrations are incremental:

| Migration | Purpose |
| --- | --- |
| 001_initial.sql | Initial entities and append-only events |
| 002_chart_threads.sql | Planned Threads |
| 003_dispatch_threads.sql | Dispatched Thread state |
| 004_commission_reliability.sql | Leases, attempts, and Artifacts |

## API overview

The development Helm is loopback-only at http://127.0.0.1:4310.

| Endpoint | Purpose |
| --- | --- |
| GET /health | Liveness |
| GET or POST /api/projects | List/register projects |
| GET or POST /api/threads | List/chart Threads |
| POST /api/threads/:id/dispatch | Dispatch a Thread |
| POST /api/hands/:id/claim | Claim a Commission |
| POST /api/runs/:id/lease | Renew a lease |
| POST /api/runs/:id/output | Record bounded output |
| POST or GET /api/runs/:id/artifacts | Store/read Workpieces |
| POST /api/runs/:id/complete | Complete a Commission |
| POST /api/runs/:id/cancel | Recall active work |
| POST /api/runs/:id/retry | Retry failed work |
| GET /api/runs/:id/events | Read Chronicle |
| POST /api/runs/:id/report | Distill a Report |
| GET /api/nodes | List active/offline Hands |
| POST /api/nodes/heartbeat | Receive a Pulse |
| WS /ws/events | Push lifecycle changes |

## Security and privacy

- Development binds services to loopback.
- PostgreSQL is not exposed outside the machine.
- Codex access is through local subscription authentication.
- OPENAI_API_KEY is forbidden.
- Development auth is temporary and only acceptable on loopback.
- Future private remote access requires Tailscale ACLs and passkey sessions.
- External mutations require scoped, expiring, one-time approval.
- Secrets, local authentication state, artifacts, worktrees, and the private
  brain stay outside the public repository.

## Windows operation

Start Docker Desktop, then run:

    powershell -NoProfile -ExecutionPolicy Bypass -File E:/Cephalon-Ordis/code/scripts/start-dev.ps1

The launcher loads the ignored environment file, starts PostgreSQL, waits for
health, applies migrations, waits for the Helm, and opens the Hand and
Observatory in separate service windows. It resolves Node and pnpm explicitly,
so stale PowerShell PATH state does not control startup.

Verify with:

    powershell -NoProfile -ExecutionPolicy Bypass -File E:/Cephalon-Ordis/code/scripts/verify.ps1

Runtime data is kept on E: and backups on D:. Docker Desktop's image/cache disk
is separate from the PostgreSQL bind mount and must be monitored independently.

## Current status

The Chart, Dispatch, Hand execution, Chronicle, and initial Observatory path is
implemented. The reliability backend is implemented in the working tree but is
not yet committed. It includes leases, recovery, cancellation, retry, artifact
persistence, Hand lease renewal, Workpiece capture, and parity tests.

The current coordinator suite has 39 tests. Typechecks, lint, and production
builds pass.

The immediate remaining work is Observatory reliability controls: show lease
and attempt status, list Workpieces, and provide clear Recall and Retry actions.
After that batch is verified, commit the reliability slice.

The next major phase is Seal: scoped approval records, expiration, atomic
one-time consumption, and an operator approval queue. Later phases add richer
Chart intelligence, multi-Hand orchestration, production authentication,
backups, Tailscale deployment, and the Tauri/voice companion.

## Further reading

- docs/architecture.md for component boundaries.
- docs/operations.md for operating procedures.
- docs/security.md for public-safe security guidance.
- docs/single-source-of-truth-audit.md for schema/store drift findings.
- E:/Cephalon-Ordis/brain for private agent context, decisions, and handoff.
