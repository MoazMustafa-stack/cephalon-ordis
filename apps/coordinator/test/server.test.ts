import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AllowanceState, AuthMode, NodePlatform, RunState } from "@ordis/shared";
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
    expect(response.json().state).toBe(RunState.enum.queued);
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
    expect(node).toMatchObject({ id: nodeId, lastSeenAt: observedAt });
    expect(node).not.toHaveProperty("nodeId");
    expect(node).not.toHaveProperty("observedAt");
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
});
