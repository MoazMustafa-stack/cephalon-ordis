import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AllowanceState, AuthMode, NODE_PULSE_TTL_MS, NodePlatform, NodePresence, RunEventType, RunState, ThreadState } from "@ordis/shared";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const apps: ReturnType<typeof buildServer>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("coordinator", () => {
  it("exposes health before authenticated API access", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.passkey,
      ORDIS_SESSION_TOKEN: "private-test-token"
    });
    apps.push(app);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, service: "ordis-coordinator" });
    const guarded = await app.inject({ method: "GET", url: "/api/runs" });
    expect(guarded.statusCode).toBe(401);
  });

  it("queues work when allowance is available", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development, ORDIS_ALLOWANCE_STATE: AllowanceState.enum.available });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { projectId: randomUUID(), command: "project-report" } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      state: RunState.enum.queued,
      commandId: null,
      payload: { command: "project-report", arguments: {} }
    });
  });

  it("rejects invalid run requests at the HTTP boundary", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { projectId: "not-a-uuid", command: "" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_run_request");
  });

  it("rejects unknown authentication modes", () => {
    expect(() => buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: "session"
    })).toThrow();
  });

  it("returns the persisted node shape after a heartbeat", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development });
    apps.push(app);
    const nodeId = randomUUID();
    const observedAt = new Date().toISOString();
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/nodes/heartbeat",
      payload: {
        nodeId,
        platform: NodePlatform.enum.windows,
        capabilities: ["codex-cli"],
        activeRuns: 0,
        allowance: AllowanceState.enum.available,
        observedAt
      }
    });
    expect(heartbeat.statusCode).toBe(204);

    const response = await app.inject({ method: "GET", url: "/api/nodes" });
    const [node] = response.json().items;
    expect(node).toMatchObject({ id: nodeId, lastSeenAt: observedAt, presence: NodePresence.enum.active });
    expect(node).not.toHaveProperty("nodeId");
    expect(node).not.toHaveProperty("observedAt");
  });

  it("marks historical Hand heartbeats offline without deleting them", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development });
    apps.push(app);
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/nodes/heartbeat",
      payload: {
        nodeId: randomUUID(),
        platform: NodePlatform.enum.windows,
        capabilities: ["codex-cli"],
        activeRuns: 0,
        allowance: AllowanceState.enum.available,
        observedAt: new Date(Date.now() - NODE_PULSE_TTL_MS - 1).toISOString()
      }
    });
    expect(heartbeat.statusCode).toBe(204);
    const response = await app.inject({ method: "GET", url: "/api/nodes" });
    expect(response.json().items).toMatchObject([{ presence: NodePresence.enum.offline }]);
  });

  it("rejects malformed approval identifiers before store access", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/approvals/not-a-uuid/consume" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_approval_id");
  });

  it("waits instead of using direct API when allowance is exhausted", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development, ORDIS_ALLOWANCE_STATE: AllowanceState.enum.exhausted });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { projectId: randomUUID(), command: "weekly-review" } });
    expect(response.json().state).toBe(RunState.enum.waiting_for_allowance);
    const guard = await app.inject({ method: "GET", url: "/api/system/allowance" });
    expect(guard.json()).toMatchObject({ mode: "subscription-only", directApiEnabled: false });
  });

  it("rejects API-key configuration", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development, OPENAI_API_KEY: "forbidden" });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/system/allowance" });
    expect(response.statusCode).toBe(500);
  });

  it("registers a project idempotently", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);

    const payload = {
      name: "Cephalon Ordis",
      repositoryPath: "E:\\Cephalon-Ordis\\code"
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject(payload);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload
    });

    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(created.json().id);

    const projects = await app.inject({
      method: "GET",
      url: "/api/projects"
    });

    expect(projects.statusCode).toBe(200);
    expect(projects.json().items).toHaveLength(1);
  });

  it("rejects an invalid project registration", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "",
        repositoryPath: ""
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_project");
  });

  it("charts a planned Thread for a registered project", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Chart test project",
        repositoryPath: "E:\\Cephalon-Ordis\\chart-api-test"
      }
    });
    const chart = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: {
        projectId: project.json().id,
        objective: "Plan the local Dispatch workflow"
      }
    });

    expect(chart.statusCode).toBe(201);
    expect(chart.json()).toMatchObject({
      projectId: project.json().id,
      objective: "Plan the local Dispatch workflow",
      state: ThreadState.enum.planned
    });
    const threads = await app.inject({ method: "GET", url: "/api/threads" });
    expect(threads.json().items).toHaveLength(1);
  });

  it("rejects an invalid Chart request at the HTTP boundary", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { projectId: "not-a-uuid", objective: "   " }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_chart_request");
  });

  it("dispatches a planned Thread to an active idle Hand and records its Chronicle event", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Dispatch test", repositoryPath: "E:\\Cephalon-Ordis\\dispatch-api-test" }
    });
    const chart = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { projectId: project.json().id, objective: "Dispatch this planned Thread" }
    });
    const nodeId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/api/nodes/heartbeat",
      payload: {
        nodeId,
        platform: NodePlatform.enum.windows,
        capabilities: ["codex-cli"],
        activeRuns: 0,
        allowance: AllowanceState.enum.available,
        observedAt: new Date().toISOString()
      }
    });

    const response = await app.inject({ method: "POST", url: `/api/threads/${chart.json().id}/dispatch` });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      thread: { id: chart.json().id, state: ThreadState.enum.dispatched },
      run: { projectId: project.json().id, assignedNodeId: nodeId, state: RunState.enum.queued },
      node: { id: nodeId },
      event: { type: RunEventType.enum["commission.dispatched"] }
    });
  });

  it("does not dispatch a planned Thread when no active Hand is available", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: AuthMode.enum.development
    });
    apps.push(app);
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Unavailable dispatch", repositoryPath: "E:\\Cephalon-Ordis\\unavailable-dispatch-test" }
    });
    const chart = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { projectId: project.json().id, objective: "Wait for a Hand" }
    });
    const response = await app.inject({ method: "POST", url: `/api/threads/${chart.json().id}/dispatch` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("dispatch_unavailable");
  });

  it("lets only the assigned Hand claim and complete its Commission", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: AuthMode.enum.development });
    apps.push(app);
    const project = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "Hand lifecycle", repositoryPath: "E:\\Cephalon-Ordis\\hand-lifecycle-test" }
    });
    const chart = await app.inject({
      method: "POST", url: "/api/threads",
      payload: { projectId: project.json().id, objective: "Complete through the Hand" }
    });
    const nodeId = randomUUID();
    await app.inject({
      method: "POST", url: "/api/nodes/heartbeat",
      payload: {
        nodeId, platform: NodePlatform.enum.windows, capabilities: ["codex-cli"], activeRuns: 0,
        allowance: AllowanceState.enum.available, observedAt: new Date().toISOString()
      }
    });
    await app.inject({ method: "POST", url: `/api/threads/${chart.json().id}/dispatch` });

    const claim = await app.inject({ method: "POST", url: `/api/hands/${nodeId}/claim` });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({
      run: { state: RunState.enum.claimed, assignedNodeId: nodeId },
      project: { id: project.json().id },
      event: { type: RunEventType.enum["commission.claimed"] }
    });
    const noneLeft = await app.inject({ method: "POST", url: `/api/hands/${nodeId}/claim` });
    expect(noneLeft.statusCode).toBe(204);

    const complete = await app.inject({
      method: "POST",
      url: `/api/runs/${claim.json().run.id}/complete`,
      payload: { nodeId, state: RunState.enum.succeeded, exitCode: 0 }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({
      run: { state: RunState.enum.succeeded, assignedNodeId: nodeId },
      event: { type: RunEventType.enum["commission.succeeded"], payload: { exitCode: 0 } }
    });
  });
});
