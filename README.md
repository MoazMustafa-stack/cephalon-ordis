# Cephalon Ordis

Cephalon Ordis is a private, local-first command center for orchestrating locally authenticated Codex CLI workers through a ChatGPT subscription. It never uses a direct OpenAI API client or API key.

## First vertical slice

- SvelteKit installable PWA in `apps/web`
- Fastify coordinator with the required REST and WebSocket surfaces
- PostgreSQL jobs, append-only events, scoped one-time approvals, reports, idea graphs, and a read-only multi-currency ledger
- Windows/Arch worker heartbeat and local `codex exec` foundation
- subscription-only cost guard with `queued` / `waiting_for_allowance` behavior
- local Ordis MCP server and seven validated plugin skills
- E:-bound Windows Compose storage and `/srv/cephalon-ordis` Arch deployment
- Rust/Tauri Windows companion foundation and local voice service boundaries

## Layout

The Git root is `E:\Cephalon-Ordis\code`. Runtime state is deliberately outside Git:

| Data | Windows | Arch |
| --- | --- | --- |
| PostgreSQL | `E:\Cephalon-Ordis\data\postgres` | `/srv/cephalon-ordis/data/postgres` |
| Artifacts | `E:\Cephalon-Ordis\data\artifacts` | `/srv/cephalon-ordis/data/artifacts` |
| Models | `E:\Cephalon-Ordis\data\models` | `/srv/cephalon-ordis/data/models` |
| Worktrees | `E:\Cephalon-Ordis\data\worktrees` | `/srv/cephalon-ordis/data/worktrees` |
| Logs | `E:\Cephalon-Ordis\data\logs` | `/srv/cephalon-ordis/data/logs` |
| Backups | `D:\Ordis-Backups` | operator-selected remote/off-host target |

## Development

1. Copy `.env.example` to `.env`, choose a PostgreSQL password, and set `ORDIS_SESSION_TOKEN`.
2. Run `pnpm install`.
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Start coordinator and PWA with `pnpm dev`.
5. Authenticate Codex locally using its normal ChatGPT sign-in, then start `pnpm --filter @ordis/worker dev`.

Use `ORDIS_AUTH_MODE=development` only on loopback during development. Private deployments use a passkey-authenticated reverse proxy/session issuer and Tailscale ACLs; the coordinator validates the resulting bearer session at its boundary.

## Verification

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm validate:skills
pnpm audit:subscription-only
```

See [architecture](docs/architecture.md), [security](docs/security.md), and [operations](docs/operations.md).

