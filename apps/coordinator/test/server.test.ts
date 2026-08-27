import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const apps: ReturnType<typeof buildServer>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("coordinator", () => {
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
});
