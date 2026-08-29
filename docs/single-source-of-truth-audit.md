# Single-source-of-truth audit

Date: 2026-08-30

Scope: `@ordis/shared`, coordinator stores and HTTP handlers, worker,
web client, MCP package, configuration examples, and the initial PostgreSQL
migration.

## Fixed drift

| ID | Location | Sources that had diverged | Resolution |
| --- | --- | --- | --- |
| D-01 | `packages/shared/src/index.ts`: `ProjectRegistration`, `Project` | The registration name was trimmed and limited to 120 characters; the persisted project name only required one character. | `Project` now extends `ProjectRegistration`. |
| D-02 | `apps/coordinator/src/server.ts`: `POST /api/runs`; `packages/ordis-mcp/src/index.ts`: `ordis_queue` | Both consumers restated a weaker run request instead of using `CommandEnvelope`. | Added `RunRequest = CommandEnvelope.pick(...)`; both boundaries use it. |
| D-03 | `apps/coordinator/src/server.ts`: authentication hook and tests | Any value other than `development`, including the obsolete test value `session`, silently enabled protected mode. | Added canonical `AuthMode`; startup rejects unknown values. |
| D-04 | `apps/coordinator/src/store.ts`: `heartbeat` and `list("nodes")`; `apps/web/src/routes/+page.svelte` | The memory store returned heartbeat fields (`nodeId`, `observedAt`) while PostgreSQL returned persisted fields (`id`, `lastSeenAt`); the web client accepted either. | Added distinct derived `NodeHeartbeat` and `NodeRecord` schemas. Both stores and the web client now use the persisted shape. |
| D-05 | `apps/worker/src/main.ts`; `apps/coordinator/src/cost-guard.ts` | Allowance environment values were asserted or manually checked, allowing malformed values across the worker/HTTP boundary. | Both paths parse the canonical `AllowanceState`; cost-guard output is parsed as `CostGuardState`. |
| D-06 | `apps/coordinator/src/store.ts`: PostgreSQL row handling | Project, node, approval, event, and project-registration rows were asserted with TypeScript casts at the database boundary. | Those aligned entities now call their shared schemas' `.parse()`. |
| D-07 | `apps/coordinator/src/store.ts`: `MemoryStore.list`, `consumeApproval` | Unsupported operations returned `[]` or `false`, which looked like valid empty results or denials. | Unsupported operations now throw explicit errors. |
| D-08 | `apps/coordinator/src/store.ts`: `MemoryStore.createRun` | Its signature omitted the payload parameter even though it implemented `OrdisStore`. | The signature now matches the interface. Payload persistence remains decision P-01. |
| D-09 | `apps/coordinator/src/store.ts`: `PgStore.list` | `ORDER BY 1 DESC` sorted UUID primary keys as though they represented recency. | Every table maps to its time/date column and uses `id` only as a deterministic tie-breaker. |
| D-10 | `apps/web/src/routes/+page.svelte`; `packages/ordis-mcp/src/index.ts` | HTTP JSON was trusted and the web client duplicated run/node/allowance shapes. | Added derived `RunSummary`, `RunListResponse`, and `NodeListResponse`; all used responses are status-checked and parsed. |
| D-11 | `packages/ordis-mcp/src/index.ts`: `ordis_queue` response | A successful run response crossed the HTTP boundary as unchecked text. | Successful responses are parsed as `RunSummary`; error bodies remain diagnostic text. |

## Consolidated latent duplication

| ID | Location | Duplicate definitions | Resolution |
| --- | --- | --- | --- |
| R-01 | `packages/shared/src/index.ts`: allowance, run state, approval status, platform, report kind, portfolio side, auth mode | Literal unions were embedded directly in entity schemas. | Exported canonical readonly value lists and Zod enums; schemas and consumers reference them. |
| R-02 | `apps/coordinator/src/store.ts`: `consumeApproval` | SQL repeated `approved` and `consumed`. | Status values are SQL parameters sourced from `ApprovalStatus.enum`. |
| R-03 | `apps/coordinator/src/store.ts`: project registration result | The store declared a local result type identical to the shared entity composition. | Added and reused `ProjectRegistrationResult`. |
| R-04 | `apps/coordinator/src/store.ts`: `registerProject`, `appendEvent` | Store methods restated shared field lists as positional parameters. | They accept parsed `ProjectRegistration` and derived `RunEventInput` objects. |
| R-05 | `packages/shared/src/index.ts`: identifiers | Project, run, node, command, approval, report, idea graph, portfolio transaction, graph node, and idempotency identifiers were interchangeable primitives. | Added Zod brands and propagated them through entity schemas and store contracts. |
| R-06 | `packages/shared/src/index.ts`: graph nodes and edges | Node `id` and edge `from`/`to` were three unrelated string declarations. | All three reuse branded `IdeaNodeId`. |
| R-07 | `db/migrations/001_initial.sql`; `packages/shared/src/index.ts` | PostgreSQL must repeat run-state, platform, allowance, and approval values in SQL. | `apps/coordinator/test/database-contract.test.ts` treats the shared arrays as canonical and fails if the migration copies drift. Historical SQL remains self-contained. |
| R-08 | In-memory construction in `apps/coordinator/src/store.ts` | Type annotations did not execute Zod refinements or defaults. | Run, event, node, project, and registration results now pass through shared schemas. |

## Product decisions required

These items are confirmed drift, but changing them would choose a product or
data-compatibility model. They were intentionally not guessed.

| ID | Location | Current conflict | Decision required |
| --- | --- | --- | --- |
| P-01 | `packages/shared/src/index.ts`: `Run`; `db/migrations/001_initial.sql`: `runs`; `apps/coordinator/src/store.ts`: `createRun` | PostgreSQL stores `payload`, but `Run` does not model it. `Run.commandId` is modeled, but create/select do not write or return it; a database null would also conflict with an optional non-null schema field. MemoryStore cannot retain payload without inventing an output model. | Decide whether payload belongs on the canonical run, whether command envelopes are persisted separately, and whether `commandId` is required, nullable, or removed. Then remove the remaining `as Run` and parse all run rows. |
| P-02 | `packages/shared/src/index.ts`: `Report`; `db/migrations/001_initial.sql`: `reports` | Shared reports have `summary` and `evidence`; the table has one untyped `body` JSONB column and no kind constraint. | Decide whether `body` contains the complete shared report or whether summary/evidence become columns. Add a migration and parse report rows afterward. |
| P-03 | `packages/shared/src/index.ts`: `IdeaGraph`; `db/migrations/001_initial.sql`: `idea_graphs` | Shared graphs expose `nodes` and `edges`; PostgreSQL exposes one `graph` JSONB value. | Decide the wire/storage representation and migration strategy, then parse graph rows. |
| P-04 | `packages/shared/src/index.ts`: `PortfolioTransaction`; PostgreSQL `numeric` columns | The shared model requires JavaScript numbers, while `pg` returns arbitrary-precision numeric values as strings by default. Coercing can lose precision. | Choose decimal strings/decimal library versus bounded JavaScript numbers; then add a canonical row mapper and parse rows. |
| P-05 | `ProjectRegistration.repositoryPath`; PostgreSQL `projects.repository_path UNIQUE`; `MemoryStore.registerProject` | Exact string equality does not represent Windows path identity: case, separators, and resolved aliases may name the same repository. | Choose a canonical path normalization and cross-platform uniqueness policy before changing persisted keys. |

Because P-01 through P-04 are unresolved, `PgStore.list` deliberately leaves
run, report, graph, and portfolio rows as unknown raw records. Safe public
consumers parse only the canonical projections they use.

## Interface review

`OrdisStore` is the only multi-implementation application contract found.
`PgStore` and `MemoryStore` now have matching method signatures. Unsupported
memory operations fail explicitly. The only remaining behavioral mismatch is
P-01 payload persistence, which is visible in this report and no longer hidden
by a narrower TypeScript method signature.

## Verification

The repository now has a real ESLint flat configuration for JavaScript,
TypeScript, and Svelte. `scripts/verify.ps1` runs:

1. tests;
2. typechecks;
3. lint;
4. builds;
5. plugin skill validation;
6. the subscription-only security audit.

Final audit run: 22 coordinator tests passed; all package typechecks passed;
ESLint passed with no findings; all builds passed; all plugin skills validated;
the subscription-only audit passed.
