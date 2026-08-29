import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const apps: ReturnType<typeof buildServer>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("coordinator", () => {
  it("exposes health before authenticated API access", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: "session",
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
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: "development", ORDIS_ALLOWANCE_STATE: "available" });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { projectId: randomUUID(), command: "project-report" } });
    expect(response.statusCode).toBe(201);
    expect(response.json().state).toBe("queued");
  });

  it("waits instead of using direct API when allowance is exhausted", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: "development", ORDIS_ALLOWANCE_STATE: "exhausted" });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { projectId: randomUUID(), command: "weekly-review" } });
    expect(response.json().state).toBe("waiting_for_allowance");
    const guard = await app.inject({ method: "GET", url: "/api/system/allowance" });
    expect(guard.json()).toMatchObject({ mode: "subscription-only", directApiEnabled: false });
  });

  it("rejects API-key configuration", async () => {
    const app = buildServer(new MemoryStore(), { NODE_ENV: "test", ORDIS_AUTH_MODE: "development", OPENAI_API_KEY: "forbidden" });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/system/allowance" });
    expect(response.statusCode).toBe(500);
  });

  it("registers a project idempotently", async () => {
    const app = buildServer(new MemoryStore(), {
      NODE_ENV: "test",
      ORDIS_AUTH_MODE: "development"
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
      ORDIS_AUTH_MODE: "development"
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
