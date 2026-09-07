import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AllowanceState, ChartRequest, CommandId, DispatchRequest, NodeHeartbeat, NodeId, NodePlatform, ProjectId, Report, ReportId, ReportKind, RunEventType, RunState, ThreadState } from "@ordis/shared";
import { MemoryStore, PgStore, type StoreTable } from "../src/store.js";

async function prepareMemoryCommission() {
  const store = new MemoryStore();
  const projectResult = await store.registerProject({
    name: "Reliability test",
    repositoryPath: "E:/Cephalon-Ordis/reliability-test"
  });
  const thread = await store.createThread({
    projectId: projectResult.project.id,
    objective: "Exercise reliability transitions"
  });
  const nodeId = NodeId.parse(randomUUID());
  await store.heartbeat({
    nodeId,
    platform: NodePlatform.enum.windows,
    capabilities: ["codex-cli"],
    activeRuns: 0,
    allowance: AllowanceState.enum.available,
    observedAt: new Date().toISOString()
  });
  await store.dispatchThread({ threadId: thread.id });
  const claim = await store.claimCommission(nodeId);
  if (!claim) throw new Error("test commission was not claimed");
  return { store, nodeId, run: claim.run };
}

describe("store contracts", () => {
  it.each([
    ["projects", "created_at"],
    ["threads", "created_at"],
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
    await expect(store.list("idea_graphs")).rejects.toThrow("does not implement");
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

  it("preserves planned Threads in PostgreSQL and memory", async () => {
    const createdAt = "2026-08-31T00:00:00.000Z";
    const projectId = ProjectId.parse(randomUUID());
    const input = ChartRequest.parse({
      projectId,
      objective: "Prepare the Dispatch implementation plan"
    });
    const pgRow = {
      id: randomUUID(),
      project_id: projectId,
      objective: input.objective,
      state: ThreadState.enum.planned,
      created_at: createdAt,
      updated_at: createdAt
    };
    const query = vi.fn().mockResolvedValue({ rows: [pgRow] });
    const pgStore = new PgStore({ query } as never);
    const memoryStore = new MemoryStore();
    await memoryStore.registerProject({
      name: "Chart test project",
      repositoryPath: "E:\\Cephalon-Ordis\\chart-test"
    });
    const [project] = await memoryStore.list("projects");
    const memoryInput = ChartRequest.parse({
      ...input,
      projectId: (project as { id: string }).id
    });

    const [postgresThread, memoryThread] = await Promise.all([
      pgStore.createThread(input),
      memoryStore.createThread(memoryInput)
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO threads(project_id,objective,state)"),
      [input.projectId, input.objective, ThreadState.enum.planned]
    );
    expect(postgresThread).toMatchObject({
      projectId: input.projectId,
      objective: input.objective,
      state: ThreadState.enum.planned
    });
    expect(memoryThread).toMatchObject({
      projectId: memoryInput.projectId,
      objective: input.objective,
      state: ThreadState.enum.planned
    });
    await expect(memoryStore.list("threads")).resolves.toEqual([memoryThread]);
  });

  it("dispatches one planned Thread to one active Hand in PostgreSQL and memory", async () => {
    const createdAt = "2026-08-31T00:00:00.000Z";
    const threadId = randomUUID();
    const projectId = ProjectId.parse(randomUUID());
    const nodeId = randomUUID();
    const runId = randomUUID();
    const pgRow = {
      thread: {
        id: threadId,
        project_id: projectId,
        objective: "Dispatch the local work",
        state: ThreadState.enum.dispatched,
        created_at: createdAt,
        updated_at: createdAt
      },
      run: {
        id: runId,
        project_id: projectId,
        command_id: null,
        state: RunState.enum.queued,
        assigned_node_id: nodeId,
        payload: { threadId, objective: "Dispatch the local work" },
        created_at: createdAt,
        updated_at: createdAt
      },
      node: {
        id: nodeId,
        platform: NodePlatform.enum.windows,
        capabilities: ["codex-cli"],
        allowance: AllowanceState.enum.available,
        active_runs: 0,
        last_seen_at: createdAt
      },
      event: {
        id: 1,
        run_id: runId,
        type: RunEventType.enum["commission.dispatched"],
        payload: { threadId, nodeId, state: RunState.enum.queued },
        occurred_at: createdAt
      }
    };
    const query = vi.fn().mockResolvedValue({ rows: [pgRow] });
    const pgStore = new PgStore({ query } as never);
    const postgres = await pgStore.dispatchThread(DispatchRequest.parse({ threadId }));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE SKIP LOCKED"), expect.any(Array));
    expect(postgres).toMatchObject({
      thread: { state: ThreadState.enum.dispatched },
      run: { assignedNodeId: nodeId, payload: { threadId } },
      event: { type: RunEventType.enum["commission.dispatched"] }
    });

    const memoryStore = new MemoryStore();
    await memoryStore.registerProject({ name: "Dispatch memory", repositoryPath: "E:\\Cephalon-Ordis\\dispatch-memory-test" });
    const [project] = await memoryStore.list("projects") as Array<{ id: string }>;
    const thread = await memoryStore.createThread(ChartRequest.parse({
      projectId: project.id,
      objective: "Dispatch the local work"
    }));
    await memoryStore.heartbeat(NodeHeartbeat.parse({
      nodeId,
      platform: NodePlatform.enum.windows,
      capabilities: ["codex-cli"],
      activeRuns: 0,
      allowance: AllowanceState.enum.available,
      observedAt: new Date().toISOString()
    }));
    const memory = await memoryStore.dispatchThread(DispatchRequest.parse({ threadId: thread.id }));
    expect(memory).toMatchObject({
      thread: { id: thread.id, state: ThreadState.enum.dispatched },
      run: { projectId: project.id, assignedNodeId: nodeId, payload: { threadId: thread.id } },
      event: { type: RunEventType.enum["commission.dispatched"] }
    });
  });

  it("recovers an expired claim and preserves the same lease-expiry contract in PostgreSQL", async () => {
    const { store, nodeId, run } = await prepareMemoryCommission();
    const internal = store as unknown as { runs: Array<{ leaseExpiresAt: string | null }> };
    internal.runs[0].leaseExpiresAt = new Date(Date.now() - 1).toISOString();

    const recovered = await store.claimCommission(nodeId);
    expect(recovered?.run).toMatchObject({
      id: run.id,
      state: RunState.enum.claimed,
      assignedNodeId: nodeId,
      attempt: 2,
      maxAttempts: 3
    });
    const memoryEvents = await store.listRunEvents(run.id);
    expect(memoryEvents.map((event) => event.type)).toContain(RunEventType.enum["commission.lease_expired"]);

    const createdAt = "2026-08-31T00:00:00.000Z";
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [{
        run: {
          id: run.id,
          project_id: run.projectId,
          command_id: null,
          state: RunState.enum.claimed,
          assigned_node_id: nodeId,
          payload: run.payload,
          lease_expires_at: "2026-08-31T00:01:00.000Z",
          attempt: 2,
          max_attempts: 3,
          created_at: createdAt,
          updated_at: createdAt
        },
        project: {
          id: run.projectId,
          name: "Reliability test",
          repository_path: "E:/Cephalon-Ordis/reliability-test",
          created_at: createdAt
        },
        event: {
          id: 99,
          run_id: run.id,
          type: RunEventType.enum["commission.claimed"],
          payload: { nodeId, attempt: 2 },
          occurred_at: createdAt
        }
      }]
    });
    const postgres = new PgStore({ query: pgQuery } as never);
    await postgres.claimCommission(nodeId);
    expect(pgQuery.mock.calls[0]?.[0]).toContain("lease_expires_at<=now()");
    expect(pgQuery.mock.calls[0]?.[1]).toContain(RunEventType.enum["commission.lease_expired"]);
  });

  it("cancels active work in memory and PostgreSQL with the same terminal event", async () => {
    const { store, nodeId, run } = await prepareMemoryCommission();
    const memoryResult = await store.cancelCommission({ runId: run.id, reason: "operator stop" });
    expect(memoryResult).toMatchObject({
      run: { state: RunState.enum.cancelled, leaseExpiresAt: null },
      event: { type: RunEventType.enum["commission.cancelled"] }
    });

    const createdAt = "2026-08-31T00:00:00.000Z";
    const query = vi.fn().mockResolvedValue({
      rows: [{
        run: {
          id: run.id,
          project_id: run.projectId,
          command_id: null,
          state: RunState.enum.cancelled,
          assigned_node_id: nodeId,
          payload: run.payload,
          lease_expires_at: null,
          attempt: 1,
          max_attempts: 3,
          created_at: createdAt,
          updated_at: createdAt
        },
        event: {
          id: 100,
          run_id: run.id,
          type: RunEventType.enum["commission.cancelled"],
          payload: { reason: "operator stop" },
          occurred_at: createdAt
        }
      }]
    });
    const postgres = new PgStore({ query } as never);
    const postgresResult = await postgres.cancelCommission({ runId: run.id, reason: "operator stop" });
    expect(postgresResult).toMatchObject({
      run: { state: RunState.enum.cancelled, leaseExpiresAt: null },
      event: { type: RunEventType.enum["commission.cancelled"] }
    });
  });

  it("requeues failed work for another attempt in memory and PostgreSQL", async () => {
    const { store, nodeId, run } = await prepareMemoryCommission();
    await store.completeCommission({ runId: run.id, nodeId, state: RunState.enum.failed, exitCode: 1 });
    const memoryResult = await store.retryCommission({ runId: run.id });
    expect(memoryResult).toMatchObject({
      run: { state: RunState.enum.queued, assignedNodeId: null, attempt: 1, maxAttempts: 3 },
      event: { type: RunEventType.enum["commission.retried"] }
    });

    const createdAt = "2026-08-31T00:00:00.000Z";
    const query = vi.fn().mockResolvedValue({
      rows: [{
        run: {
          id: run.id,
          project_id: run.projectId,
          command_id: null,
          state: RunState.enum.queued,
          assigned_node_id: null,
          payload: run.payload,
          lease_expires_at: null,
          attempt: 1,
          max_attempts: 3,
          created_at: createdAt,
          updated_at: createdAt
        },
        event: {
          id: 101,
          run_id: run.id,
          type: RunEventType.enum["commission.retried"],
          payload: { attempt: 1, maxAttempts: 3 },
          occurred_at: createdAt
        }
      }]
    });
    const postgres = new PgStore({ query } as never);
    const postgresResult = await postgres.retryCommission({ runId: run.id });
    expect(postgresResult).toMatchObject({
      run: { state: RunState.enum.queued, assignedNodeId: null, attempt: 1 },
      event: { type: RunEventType.enum["commission.retried"] }
    });
    expect(query.mock.calls[0]?.[0]).toContain("attempt < max_attempts");
  });

  it("persists the complete canonical Report document in PostgreSQL and memory", async () => {
    const report = Report.parse({
      id: ReportId.parse(randomUUID()),
      projectId: ProjectId.parse(randomUUID()),
      kind: ReportKind.enum.validation,
      title: "Commission Chronicle",
      summary: "Completed with evidence.",
      evidence: [],
      generatedAt: "2026-08-31T00:00:00.000Z"
    });
    const query = vi.fn().mockResolvedValue({ rows: [{ body: report }] });
    const postgres = new PgStore({ query } as never);
    const memory = new MemoryStore();
    await expect(postgres.createReport(report)).resolves.toEqual(report);
    await expect(memory.createReport(report)).resolves.toEqual(report);
    await expect(memory.list("reports")).resolves.toEqual([report]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO reports"), [
      report.id, report.projectId, report.kind, report.title, report, report.generatedAt
    ]);
  });
});
