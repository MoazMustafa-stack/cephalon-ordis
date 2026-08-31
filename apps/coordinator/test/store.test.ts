import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CommandId, ProjectId, RunState } from "@ordis/shared";
import { MemoryStore, PgStore, type StoreTable } from "../src/store.js";

describe("store contracts", () => {
  it.each([
    ["projects", "created_at"],
    ["nodes", "last_seen_at"],
    ["runs", "created_at"],
    ["approval_requests", "expires_at"],
    ["reports", "generated_at"],
    ["idea_graphs", "updated_at"],
    ["portfolio_transactions", "occurred_on"]
  ] satisfies Array<[StoreTable, string]>)("orders %s by its time column", async (table, column) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PgStore({ query } as never);
    await store.list(table);
    expect(query).toHaveBeenCalledWith(
      `SELECT * FROM ${table} ORDER BY ${column} DESC, id DESC LIMIT 200`
    );
  });

  it("throws for unsupported MemoryStore tables", async () => {
    const store = new MemoryStore();
    await expect(store.list("reports")).rejects.toThrow("does not implement");
  });

  it("preserves command ID and payload in PostgreSQL and memory runs", async () => {
    const createdAt = "2026-08-31T00:00:00.000Z";
    const input = {
      projectId: ProjectId.parse(randomUUID()),
      commandId: CommandId.parse(randomUUID()),
      state: RunState.enum.queued,
      payload: { command: "project-report", arguments: { period: "weekly" } }
    };
    const pgRow = {
      id: randomUUID(),
      project_id: input.projectId,
      command_id: input.commandId,
      state: input.state,
      assigned_node_id: null,
      payload: input.payload,
      created_at: createdAt,
      updated_at: createdAt
    };
    const query = vi.fn().mockResolvedValue({ rows: [pgRow] });
    const pgStore = new PgStore({ query } as never);
    const memoryStore = new MemoryStore();

    const [postgresRun, memoryRun] = await Promise.all([
      pgStore.createRun(input),
      memoryStore.createRun(input)
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO runs(project_id,command_id,state,payload)"),
      [input.projectId, input.commandId, input.state, input.payload]
    );

    const expected = {
      projectId: input.projectId,
      commandId: input.commandId,
      state: input.state,
      assignedNodeId: null,
      payload: input.payload
    };
    expect(postgresRun).toMatchObject(expected);
    expect(memoryRun).toMatchObject(expected);
    await expect(memoryStore.list("runs")).resolves.toEqual([memoryRun]);
  });

  it("parses every persisted run and rejects malformed rows", async () => {
    const validRow = {
      id: randomUUID(),
      project_id: randomUUID(),
      command_id: null,
      state: RunState.enum.queued,
      assigned_node_id: null,
      payload: { command: "project-report" },
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z"
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [validRow] })
      .mockResolvedValueOnce({ rows: [{ ...validRow, payload: [] }] });
    const store = new PgStore({ query } as never);

    await expect(store.list("runs")).resolves.toMatchObject([
      { commandId: null, payload: { command: "project-report" } }
    ]);
    await expect(store.list("runs")).rejects.toThrow();
  });
});
