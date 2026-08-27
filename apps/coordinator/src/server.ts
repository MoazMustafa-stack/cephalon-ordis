import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { NodeHeartbeat } from "@ordis/shared";
import { initialRunState, readCostGuard } from "./cost-guard.js";
import type { OrdisStore } from "./store.js";

const tableRoutes = {
  "/api/projects": "projects",
  "/api/nodes": "nodes",
  "/api/runs": "runs",
  "/api/approvals": "approval_requests",
  "/api/reports": "reports",
  "/api/ideas": "idea_graphs"
} as const;

export function buildServer(store: OrdisStore, env: NodeJS.ProcessEnv = process.env) {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  const clients = new Set<{ send(data: string): void; readyState: number }>();
  app.register(cors, { origin: env.ORDIS_PUBLIC_ORIGIN?.split(",") ?? false, credentials: true });
  app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || env.ORDIS_AUTH_MODE === "development") return;
    const expected = env.ORDIS_SESSION_TOKEN;
    if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: "passkey_session_required" });
    }
  });

  app.get("/health", async () => ({ ok: true, service: "ordis-coordinator" }));
  for (const [route, table] of Object.entries(tableRoutes)) {
    app.get(route, async () => ({ items: await store.list(table) }));
  }
  app.get("/api/artifacts", async () => ({ items: [], root: env.ORDIS_DATA_ROOT ? `${env.ORDIS_DATA_ROOT}\\artifacts` : null }));
  app.get("/api/portfolio/developer", async () => ({ mode: "read-only", items: [] }));
  app.get("/api/portfolio/investments", async () => ({ mode: "read-only", items: await store.list("portfolio_transactions") }));
  app.get("/api/system/allowance", async () => readCostGuard(env));

  app.post<{ Body: { projectId?: string; command?: string; arguments?: Record<string, unknown> } }>("/api/runs", async (request, reply) => {
    if (!request.body?.projectId || !request.body.command) return reply.code(400).send({ error: "projectId and command are required" });
    const guard = readCostGuard(env);
    const run = await store.createRun(request.body.projectId, initialRunState(guard), {
      command: request.body.command, arguments: request.body.arguments ?? {}
    });
    const event = await store.appendEvent(run.id, "run.created", { state: run.state });
    const wire = JSON.stringify(event);
    for (const client of clients) if (client.readyState === 1) client.send(wire);
    return reply.code(201).send(run);
  });

  app.post<{ Body: unknown }>("/api/nodes/heartbeat", async (request, reply) => {
    const parsed = NodeHeartbeat.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_heartbeat", issues: parsed.error.issues });
    await store.heartbeat(parsed.data);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/approvals/:id/consume", async (request, reply) => {
    const consumed = await store.consumeApproval(request.params.id);
    return consumed ? reply.code(204).send() : reply.code(409).send({ error: "approval_not_active" });
  });

  app.post("/api/voice/transcribe", async (_, reply) => reply.code(503).send({ error: "local_whisper_unavailable" }));
  app.post("/api/voice/speak", async (_, reply) => reply.code(503).send({ error: "local_piper_unavailable" }));

  app.get("/ws/events", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
    socket.on("close", () => clients.delete(socket));
  });
  app.get("/ws/voice", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "voice.ready", localOnly: true }));
  });

  app.addHook("onClose", async () => store.close());
  return app;
}
