import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ApprovalId, AuthMode, ChartRequest, CommissionCompletionInput, DispatchRequest, NodeHeartbeat, NodeId, NodeRecord, presentNode, ProjectRegistration, RunId, RunRequest } from "@ordis/shared";
import { initialRunState, readCostGuard } from "./cost-guard.js";
import { CommissionTransitionError, DispatchUnavailableError, type OrdisStore } from "./store.js";

const tableRoutes = {
  "/api/projects": "projects",
  "/api/threads": "threads",
  "/api/runs": "runs",
  "/api/approvals": "approval_requests",
  "/api/reports": "reports",
  "/api/ideas": "idea_graphs"
} as const;

export function buildServer(store: OrdisStore, env: NodeJS.ProcessEnv = process.env) {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  const clients = new Set<{ send(data: string): void; readyState: number }>();
  const authMode = AuthMode.parse(env.ORDIS_AUTH_MODE ?? AuthMode.enum.passkey);
  app.register(cors, { origin: env.ORDIS_PUBLIC_ORIGIN?.split(",") ?? false, credentials: true });
  app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || authMode === AuthMode.enum.development) return;
    const expected = env.ORDIS_SESSION_TOKEN;
    if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: "passkey_session_required" });
    }
  });

  app.get("/health", async () => ({ ok: true, service: "ordis-coordinator" }));
  for (const [route, table] of Object.entries(tableRoutes)) {
    app.get(route, async () => ({ items: await store.list(table) }));
  }
  app.get("/api/nodes", async () => ({
    items: (await store.list("nodes")).map((node) => presentNode(NodeRecord.parse(node)))
  }));
  app.post<{ Body: unknown }>("/api/projects", async (request, reply) => {
    const parsed = ProjectRegistration.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_project",
        issues: parsed.error.issues
      });
    }

    const result = await store.registerProject(parsed.data);

    return reply
      .code(result.created ? 201 : 200)
      .send(result.project);
  });
  app.post<{ Body: unknown }>("/api/threads", async (request, reply) => {
    const parsed = ChartRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_chart_request", issues: parsed.error.issues });
    }
    const thread = await store.createThread(parsed.data);
    return reply.code(201).send(thread);
  });
  app.post<{ Params: { id: string } }>("/api/threads/:id/dispatch", async (request, reply) => {
    const parsed = DispatchRequest.safeParse({ threadId: request.params.id });
    if (!parsed.success) return reply.code(400).send({ error: "invalid_dispatch_request", issues: parsed.error.issues });
    try {
      const result = await store.dispatchThread(parsed.data);
      const wire = JSON.stringify(result.event);
      for (const client of clients) if (client.readyState === 1) client.send(wire);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof DispatchUnavailableError) {
        return reply.code(409).send({ error: "dispatch_unavailable" });
      }
      throw error;
    }
  });
  app.post<{ Params: { id: string } }>("/api/hands/:id/claim", async (request, reply) => {
    const parsed = NodeId.safeParse(request.params.id);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_hand_id" });
    const claim = await store.claimCommission(parsed.data);
    return claim ? reply.code(200).send(claim) : reply.code(204).send();
  });
  app.post<{ Params: { id: string }; Body: unknown }>("/api/runs/:id/complete", async (request, reply) => {
    const runId = RunId.safeParse(request.params.id);
    const body = typeof request.body === "object" && request.body !== null ? request.body : {};
    const completion = CommissionCompletionInput.safeParse({ ...body, runId: runId.success ? runId.data : request.params.id });
    if (!runId.success || !completion.success) {
      return reply.code(400).send({ error: "invalid_commission_completion" });
    }
    try {
      const result = await store.completeCommission(completion.data);
      const wire = JSON.stringify(result.event);
      for (const client of clients) if (client.readyState === 1) client.send(wire);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof CommissionTransitionError) {
        return reply.code(409).send({ error: "commission_transition_unavailable" });
      }
      throw error;
    }
  });
  app.get("/api/artifacts", async () => ({ items: [], root: env.ORDIS_DATA_ROOT ? `${env.ORDIS_DATA_ROOT}\\artifacts` : null }));
  app.get("/api/portfolio/developer", async () => ({ mode: "read-only", items: [] }));
  app.get("/api/portfolio/investments", async () => ({ mode: "read-only", items: await store.list("portfolio_transactions") }));
  app.get("/api/system/allowance", async () => readCostGuard(env));

  app.post<{ Body: unknown }>("/api/runs", async (request, reply) => {
    const parsed = RunRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_run_request", issues: parsed.error.issues });
    const guard = readCostGuard(env);
    const run = await store.createRun({
      projectId: parsed.data.projectId,
      commandId: null,
      state: initialRunState(guard),
      payload: {
        command: parsed.data.command,
        arguments: parsed.data.arguments
      }
    });
    const event = await store.appendEvent({
      runId: run.id,
      type: "run.created",
      payload: { state: run.state }
    });
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
    const parsedId = ApprovalId.safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: "invalid_approval_id" });
    const consumed = await store.consumeApproval(parsedId.data);
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
