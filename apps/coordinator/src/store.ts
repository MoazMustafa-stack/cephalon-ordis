import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  Artifact,
  ArtifactId,
  ArtifactInput,
  ArtifactReceipt,
  ApprovalRequest,
  ApprovalStatus,
  ACTIVE_ASSIGNMENT_RUN_STATES,
  CommissionClaim,
  CommissionCompletion,
  CommissionCompletionInput,
  CommissionCancellation,
  CommissionCancellationInput,
  CommissionOutputInput,
  CommissionLeaseRenewal,
  CommissionLeaseRenewalInput,
  CommissionRetry,
  CommissionRetryInput,
  COMMISSION_LEASE_DURATION_MS,
  NodeHeartbeat,
  NodeId,
  NodeRecord,
  DISPATCHABLE_ALLOWANCE_STATES,
  DispatchRequest,
  DispatchResult,
  DispatchRunPayload,
  MAX_DISPATCH_ACTIVE_RUNS,
  Project,
  ProjectId,
  ProjectRegistration,
  ProjectRegistrationResult,
  Report,
  Run,
  RunCreateInput,
  RunEvent,
  RunEventInput,
  RunEventType,
  RunId,
  Thread,
  ThreadId,
  ChartRequest,
  ThreadState,
  RunState,
  isDispatchableNode,
  nodeFreshnessCutoff
} from "@ordis/shared";

export type JsonRecord = Record<string, unknown>;
const TABLE_ORDER = {
  artifacts: "created_at",
  projects: "created_at",
  threads: "created_at",
  nodes: "last_seen_at",
  runs: "created_at",
  approval_requests: "expires_at",
  reports: "generated_at",
  idea_graphs: "updated_at",
  portfolio_transactions: "occurred_on"
} as const;
export type StoreTable = keyof typeof TABLE_ORDER;
const RUN_COLUMNS = "id,project_id,command_id,state,assigned_node_id,payload,lease_expires_at,attempt,max_attempts,created_at,updated_at";

export interface OrdisStore {
  list(table: StoreTable): Promise<unknown[]>;
  createRun(input: RunCreateInput): Promise<Run>;
  appendEvent(input: RunEventInput): Promise<RunEvent>;
  appendCommissionOutput(input: CommissionOutputInput): Promise<RunEvent>;
  createArtifact(input: ArtifactInput): Promise<ArtifactReceipt>;
  listRunArtifacts(runId: Run["id"]): Promise<Artifact[]>;
  listRunEvents(runId: Run["id"]): Promise<RunEvent[]>;
  heartbeat(heartbeat: NodeHeartbeat): Promise<void>;
  consumeApproval(id: ApprovalRequest["id"]): Promise<boolean>;
  registerProject(input: ProjectRegistration): Promise<ProjectRegistrationResult>;
  createThread(input: ChartRequest): Promise<Thread>;
  dispatchThread(input: DispatchRequest): Promise<DispatchResult>;
  claimCommission(nodeId: NodeHeartbeat["nodeId"]): Promise<CommissionClaim | null>;
  renewCommissionLease(input: CommissionLeaseRenewalInput): Promise<CommissionLeaseRenewal>;
  completeCommission(input: CommissionCompletionInput): Promise<CommissionCompletion>;
  cancelCommission(input: CommissionCancellationInput): Promise<CommissionCancellation>;
  retryCommission(input: CommissionRetryInput): Promise<CommissionRetry>;
  createReport(report: Report): Promise<Report>;
  close(): Promise<void>;
}

export class DispatchUnavailableError extends Error {
  constructor() {
    super("Dispatch requires a planned Thread and an active available Hand");
    this.name = "DispatchUnavailableError";
  }
}

export class CommissionTransitionError extends Error {
  constructor() {
    super("The Commission is not assigned to this Hand in the required state");
    this.name = "CommissionTransitionError";
  }
}

const camel = (row: JsonRecord): JsonRecord => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value instanceof Date ? value.toISOString() : value])
);

export class PgStore implements OrdisStore {
  constructor(private readonly pool: Pool) {}
  static connect(connectionString: string) { return new PgStore(new Pool({ connectionString })); }

  async list(table: StoreTable) {
    const result = await this.pool.query(
      `SELECT * FROM ${table} ORDER BY ${TABLE_ORDER[table]} DESC, id DESC LIMIT 200`
    );
    const rows = result.rows.map(camel);
    if (table === "projects") return rows.map((row) => Project.parse(row));
    if (table === "threads") return rows.map((row) => Thread.parse(row));
    if (table === "nodes") return rows.map((row) => NodeRecord.parse(row));
    if (table === "runs") return rows.map((row) => Run.parse(row));
    if (table === "artifacts") return rows.map((row) => Artifact.parse(row));
    if (table === "approval_requests") return rows.map((row) => ApprovalRequest.parse(row));
    if (table === "reports") return rows.map((row) => Report.parse(row.body));
    return rows;
  }
  async createRun(input: RunCreateInput) {
    const runInput = RunCreateInput.parse(input);
    const result = await this.pool.query(
      `INSERT INTO runs(project_id,command_id,state,payload) VALUES ($1,$2,$3,$4)
       RETURNING ${RUN_COLUMNS}`,
      [runInput.projectId, runInput.commandId, runInput.state, runInput.payload]
    );
    return Run.parse(camel(result.rows[0]));
  }
  async appendEvent(input: RunEventInput) {
    const event = RunEventInput.parse(input);
    const result = await this.pool.query(
      `INSERT INTO run_events(run_id,type,payload) VALUES ($1,$2,$3) RETURNING id,run_id,type,payload,occurred_at`,
      [event.runId, event.type, event.payload]
    );
    return RunEvent.parse(camel(result.rows[0]));
  }
  async appendCommissionOutput(input: CommissionOutputInput) {
    const output = CommissionOutputInput.parse(input);
    const result = await this.pool.query(
      `INSERT INTO run_events(run_id,type,payload)
       SELECT $1,$4,jsonb_build_object('stdout',$5,'stderr',$6,'truncated',$7)
       WHERE EXISTS (SELECT 1 FROM runs WHERE id=$1 AND assigned_node_id=$2 AND state=$3 AND lease_expires_at>now())
       RETURNING id,run_id,type,payload,occurred_at`,
      [output.runId, output.nodeId, RunState.enum.claimed, RunEventType.enum["commission.output"], output.stdout, output.stderr, output.truncated]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    return RunEvent.parse(camel(result.rows[0]));
  }
  async createArtifact(input: ArtifactInput) {
    const artifact = ArtifactInput.parse(input);
    const result = await this.pool.query(
      `WITH permitted_run AS (
         SELECT id FROM runs WHERE id=$1 AND assigned_node_id=$2 AND state=$3 AND lease_expires_at>now()
       ), created_artifact AS (
         INSERT INTO artifacts(id,run_id,kind,label,media_type,body,sha256)
         SELECT $4,$1,$5,$6,$7,$8,$9 FROM permitted_run
         RETURNING id,run_id,kind,label,media_type,body,sha256,created_at
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT created_artifact.run_id,$10,jsonb_build_object(
           'artifactId',created_artifact.id,'kind',created_artifact.kind,
           'label',created_artifact.label,'sha256',created_artifact.sha256
         ) FROM created_artifact
         RETURNING id,run_id,type,payload,occurred_at
       )
       SELECT row_to_json(created_artifact) AS artifact,row_to_json(created_event) AS event
       FROM created_artifact CROSS JOIN created_event`,
      [
        artifact.runId, artifact.nodeId, RunState.enum.claimed, randomUUID(), artifact.kind,
        artifact.label, artifact.mediaType, artifact.body, artifact.sha256,
        RunEventType.enum["commission.artifact"]
      ]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    const row = result.rows[0] as { artifact: JsonRecord; event: JsonRecord };
    return ArtifactReceipt.parse({ artifact: camel(row.artifact), event: camel(row.event) });
  }
  async listRunArtifacts(runId: Run["id"]) {
    const result = await this.pool.query(
      "SELECT id,run_id,kind,label,media_type,body,sha256,created_at FROM artifacts WHERE run_id=$1 ORDER BY created_at ASC,id ASC",
      [RunId.parse(runId)]
    );
    return result.rows.map((row) => Artifact.parse(camel(row)));
  }
  async listRunEvents(runId: Run["id"]) {
    const result = await this.pool.query(
      "SELECT id,run_id,type,payload,occurred_at FROM run_events WHERE run_id=$1 ORDER BY id ASC",
      [RunId.parse(runId)]
    );
    return result.rows.map((row) => RunEvent.parse(camel(row)));
  }
  async heartbeat(input: NodeHeartbeat) {
    const h = NodeHeartbeat.parse(input);
    await this.pool.query(
      `INSERT INTO nodes(id,platform,capabilities,allowance,active_runs,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET platform=excluded.platform, capabilities=excluded.capabilities,
       allowance=excluded.allowance, active_runs=excluded.active_runs, last_seen_at=excluded.last_seen_at`,
      [h.nodeId, h.platform, JSON.stringify(h.capabilities), h.allowance, h.activeRuns, h.observedAt]
    );
  }
  async consumeApproval(id: ApprovalRequest["id"]) {
    const result = await this.pool.query(
      `UPDATE approval_requests SET status=$2,consumed_at=now()
       WHERE id=$1 AND status=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING id`,
      [id, ApprovalStatus.enum.consumed, ApprovalStatus.enum.approved]
    );
    return result.rowCount === 1;
  }
  async registerProject(input: ProjectRegistration): Promise<ProjectRegistrationResult> {
    const project = ProjectRegistration.parse(input);
    const result = await this.pool.query(
      `WITH inserted AS (
        INSERT INTO projects(name, repository_path)
        VALUES ($1, $2)
        ON CONFLICT(repository_path) DO NOTHING
        RETURNING id, name, repository_path, created_at, true AS created
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT id, name, repository_path, created_at, false AS created
      FROM projects
      WHERE repository_path = $2
      LIMIT 1`,
      [project.name, project.repositoryPath]
    );

    const row = camel(result.rows[0]);
    return ProjectRegistrationResult.parse({ project: row, created: row.created });
  }
  async createThread(input: ChartRequest) {
    const chart = ChartRequest.parse(input);
    const result = await this.pool.query(
      `INSERT INTO threads(project_id,objective,state) VALUES ($1,$2,$3)
       RETURNING id,project_id,objective,state,created_at,updated_at`,
      [chart.projectId, chart.objective, ThreadState.enum.planned]
    );
    return Thread.parse(camel(result.rows[0]));
  }
  async dispatchThread(input: DispatchRequest) {
    const dispatch = DispatchRequest.parse(input);
    const result = await this.pool.query(
      `WITH target_thread AS (
         SELECT id, project_id, objective, state, created_at, updated_at
         FROM threads WHERE id=$1 AND state=$2
       ), selected_node AS (
         SELECT nodes.* FROM nodes
         WHERE EXISTS (SELECT 1 FROM target_thread)
           AND last_seen_at >= $3
           AND active_runs <= $4
           AND allowance = ANY($5::text[])
           AND NOT EXISTS (
             SELECT 1 FROM runs
             WHERE assigned_node_id=nodes.id AND state = ANY($6::run_state[])
           )
         ORDER BY last_seen_at DESC
         LIMIT 1 FOR UPDATE SKIP LOCKED
       ), updated_thread AS (
         UPDATE threads SET state=$7, updated_at=now()
         FROM target_thread, selected_node
         WHERE threads.id=target_thread.id
         RETURNING threads.id, threads.project_id, threads.objective, threads.state, threads.created_at, threads.updated_at
       ), created_run AS (
         INSERT INTO runs(project_id,command_id,state,assigned_node_id,payload)
         SELECT updated_thread.project_id, NULL, $8, selected_node.id,
           jsonb_build_object('threadId', updated_thread.id, 'objective', updated_thread.objective)
         FROM updated_thread CROSS JOIN selected_node
         RETURNING id, project_id, command_id, state, assigned_node_id, payload, created_at, updated_at
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT created_run.id, $9,
           jsonb_build_object('threadId', updated_thread.id, 'nodeId', selected_node.id, 'state', created_run.state)
         FROM created_run CROSS JOIN updated_thread CROSS JOIN selected_node
         RETURNING id, run_id, type, payload, occurred_at
       )
       SELECT row_to_json(updated_thread) AS thread, row_to_json(created_run) AS run,
              row_to_json(selected_node) AS node, row_to_json(created_event) AS event
       FROM updated_thread CROSS JOIN created_run CROSS JOIN selected_node CROSS JOIN created_event`,
      [
        dispatch.threadId,
        ThreadState.enum.planned,
        nodeFreshnessCutoff(),
        MAX_DISPATCH_ACTIVE_RUNS,
        DISPATCHABLE_ALLOWANCE_STATES,
        ACTIVE_ASSIGNMENT_RUN_STATES,
        ThreadState.enum.dispatched,
        RunState.enum.queued,
        RunEventType.enum["commission.dispatched"]
      ]
    );
    if (!result.rows[0]) throw new DispatchUnavailableError();
    const row = result.rows[0] as { thread: JsonRecord; run: JsonRecord; node: JsonRecord; event: JsonRecord };
    return DispatchResult.parse({
      thread: camel(row.thread),
      run: camel(row.run),
      node: camel(row.node),
      event: camel(row.event)
    });
  }
  async claimCommission(nodeId: NodeHeartbeat["nodeId"]) {
    const handId = NodeId.parse(nodeId);
    const result = await this.pool.query(
      `WITH recovered_runs AS (
         UPDATE runs SET state=CASE WHEN attempt < max_attempts THEN $2 ELSE $4 END,
           assigned_node_id=NULL, lease_expires_at=NULL, updated_at=now()
         WHERE state=$3 AND lease_expires_at<=now()
         RETURNING id,state,attempt,max_attempts
       ), recovered_events AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT id,$5,jsonb_build_object('state',state,'attempt',attempt,'maxAttempts',max_attempts)
         FROM recovered_runs
       ), selected_run AS (
         SELECT id FROM runs
         WHERE state=$2 AND attempt < max_attempts AND (assigned_node_id=$1 OR assigned_node_id IS NULL)
           AND EXISTS (SELECT 1 FROM nodes WHERE id=$1 AND last_seen_at >= $6)
         ORDER BY CASE WHEN assigned_node_id=$1 THEN 0 ELSE 1 END, created_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED
       ), claimed_run AS (
         UPDATE runs SET state=$8, assigned_node_id=$1, attempt=attempt+1,
           lease_expires_at=now() + ($7 * interval '1 millisecond'), updated_at=now()
         FROM selected_run WHERE runs.id=selected_run.id
         RETURNING runs.id,runs.project_id,runs.command_id,runs.state,runs.assigned_node_id,runs.payload,
           runs.lease_expires_at,runs.attempt,runs.max_attempts,runs.created_at,runs.updated_at
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT claimed_run.id,$9,jsonb_build_object('nodeId',$1,'state',claimed_run.state,
           'attempt',claimed_run.attempt,'leaseExpiresAt',claimed_run.lease_expires_at)
         FROM claimed_run
         RETURNING id,run_id,type,payload,occurred_at
       )
       SELECT row_to_json(claimed_run) AS run, row_to_json(projects) AS project,
              row_to_json(created_event) AS event
       FROM claimed_run
       JOIN projects ON projects.id=claimed_run.project_id
       CROSS JOIN created_event`,
      [
        handId, RunState.enum.queued, RunState.enum.claimed, RunState.enum.failed,
        RunEventType.enum["commission.lease_expired"], nodeFreshnessCutoff(), COMMISSION_LEASE_DURATION_MS,
        RunState.enum.claimed, RunEventType.enum["commission.claimed"]
      ]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0] as { run: JsonRecord; project: JsonRecord; event: JsonRecord };
    return CommissionClaim.parse({ run: camel(row.run), project: camel(row.project), event: camel(row.event) });
  }
  async renewCommissionLease(input: CommissionLeaseRenewalInput) {
    const renewal = CommissionLeaseRenewalInput.parse(input);
    const result = await this.pool.query(
      `UPDATE runs SET lease_expires_at=now() + ($3 * interval '1 millisecond'), updated_at=now()
       WHERE id=$1 AND assigned_node_id=$2 AND state=$4 AND lease_expires_at>now()
       RETURNING ${RUN_COLUMNS}`,
      [renewal.runId, renewal.nodeId, COMMISSION_LEASE_DURATION_MS, RunState.enum.claimed]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    return CommissionLeaseRenewal.parse({ run: camel(result.rows[0]) });
  }
  async cancelCommission(input: CommissionCancellationInput) {
    const cancellation = CommissionCancellationInput.parse(input);
    const result = await this.pool.query(
      `WITH cancelled_run AS (
         UPDATE runs SET state=$2, lease_expires_at=NULL, updated_at=now()
         WHERE id=$1 AND state <> ALL($3::run_state[])
         RETURNING ${RUN_COLUMNS}
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT id,$4,jsonb_build_object('state',state,'reason',$5) FROM cancelled_run
         RETURNING id,run_id,type,payload,occurred_at
       )
       SELECT row_to_json(cancelled_run) AS run,row_to_json(created_event) AS event
       FROM cancelled_run CROSS JOIN created_event`,
      [
        cancellation.runId, RunState.enum.cancelled,
        [RunState.enum.succeeded, RunState.enum.failed, RunState.enum.cancelled],
        RunEventType.enum["commission.cancelled"], cancellation.reason
      ]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    const row = result.rows[0] as { run: JsonRecord; event: JsonRecord };
    return CommissionCancellation.parse({ run: camel(row.run), event: camel(row.event) });
  }
  async retryCommission(input: CommissionRetryInput) {
    const retry = CommissionRetryInput.parse(input);
    const result = await this.pool.query(
      `WITH retried_run AS (
         UPDATE runs SET state=$2, assigned_node_id=NULL, lease_expires_at=NULL, updated_at=now()
         WHERE id=$1 AND state=$3 AND attempt < max_attempts
         RETURNING ${RUN_COLUMNS}
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT id,$4,jsonb_build_object('state',state,'attempt',attempt,'maxAttempts',max_attempts)
         FROM retried_run RETURNING id,run_id,type,payload,occurred_at
       )
       SELECT row_to_json(retried_run) AS run,row_to_json(created_event) AS event
       FROM retried_run CROSS JOIN created_event`,
      [retry.runId, RunState.enum.queued, RunState.enum.failed, RunEventType.enum["commission.retried"]]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    const row = result.rows[0] as { run: JsonRecord; event: JsonRecord };
    return CommissionRetry.parse({ run: camel(row.run), event: camel(row.event) });
  }
  async completeCommission(input: CommissionCompletionInput) {
    const completion = CommissionCompletionInput.parse(input);
    const eventType = completion.state === RunState.enum.succeeded
      ? RunEventType.enum["commission.succeeded"]
      : RunEventType.enum["commission.failed"];
    const result = await this.pool.query(
      `WITH completed_run AS (
         UPDATE runs SET state=$3, lease_expires_at=NULL, updated_at=now()
         WHERE id=$1 AND assigned_node_id=$2 AND state=$4 AND lease_expires_at>now()
         RETURNING ${RUN_COLUMNS}
       ), created_event AS (
         INSERT INTO run_events(run_id,type,payload)
         SELECT completed_run.id, $5, jsonb_build_object('nodeId', $2, 'state', completed_run.state, 'exitCode', $6)
         FROM completed_run
         RETURNING id, run_id, type, payload, occurred_at
       )
       SELECT row_to_json(completed_run) AS run, row_to_json(created_event) AS event
       FROM completed_run CROSS JOIN created_event`,
      [completion.runId, completion.nodeId, completion.state, RunState.enum.claimed, eventType, completion.exitCode]
    );
    if (!result.rows[0]) throw new CommissionTransitionError();
    const row = result.rows[0] as { run: JsonRecord; event: JsonRecord };
    return CommissionCompletion.parse({ run: camel(row.run), event: camel(row.event) });
  }
  async createReport(input: Report) {
    const report = Report.parse(input);
    const result = await this.pool.query(
      "INSERT INTO reports(id,project_id,kind,title,body,generated_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING body",
      [report.id, report.projectId, report.kind, report.title, report, report.generatedAt]
    );
    return Report.parse(result.rows[0].body);
  }
  async close() { await this.pool.end(); }
}

export class MemoryStore implements OrdisStore {
  private runs: Run[] = [];
  private events: RunEvent[] = [];
  private artifacts: Artifact[] = [];
  private nodes: NodeRecord[] = [];
  private projects: Project[] = [];
  private threads: Thread[] = [];
  private reports: Report[] = [];

  async list(table: StoreTable) {
    if (table === "projects") return this.projects;
    if (table === "threads") return this.threads;
    if (table === "runs") return this.runs;
    if (table === "artifacts") return this.artifacts;
    if (table === "nodes") return this.nodes;
    if (table === "reports") return this.reports;
    throw new Error(`MemoryStore does not implement list(${table})`);
  }
  async createRun(input: RunCreateInput) {
    const runInput = RunCreateInput.parse(input);
    const now = new Date().toISOString();
    const run = Run.parse({
      id: RunId.parse(randomUUID()),
      ...runInput,
      assignedNodeId: null,
      leaseExpiresAt: null,
      attempt: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now
    });
    this.runs.unshift(run);
    return run;
  }
  async appendEvent(input: RunEventInput) {
    const eventInput = RunEventInput.parse(input);
    const event = RunEvent.parse({ id: this.events.length + 1, ...eventInput, occurredAt: new Date().toISOString() });
    this.events.push(event);
    return event;
  }
  async appendCommissionOutput(input: CommissionOutputInput) {
    const output = CommissionOutputInput.parse(input);
    if (!this.runs.some((run) => run.id === output.runId && run.assignedNodeId === output.nodeId && run.state === RunState.enum.claimed && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now())) {
      throw new CommissionTransitionError();
    }
    return this.appendEvent({
      runId: output.runId,
      type: RunEventType.enum["commission.output"],
      payload: { stdout: output.stdout, stderr: output.stderr, truncated: output.truncated }
    });
  }
  async createArtifact(input: ArtifactInput) {
    const artifactInput = ArtifactInput.parse(input);
    const run = this.runs.find((item) => item.id === artifactInput.runId && item.assignedNodeId === artifactInput.nodeId
      && item.state === RunState.enum.claimed && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) > Date.now());
    if (!run) throw new CommissionTransitionError();
    const artifact = Artifact.parse({
      id: ArtifactId.parse(randomUUID()), runId: artifactInput.runId, kind: artifactInput.kind, label: artifactInput.label,
      mediaType: artifactInput.mediaType, body: artifactInput.body, sha256: artifactInput.sha256, createdAt: new Date().toISOString()
    });
    const event = await this.appendEvent({ runId: run.id, type: RunEventType.enum["commission.artifact"],
      payload: { artifactId: artifact.id, kind: artifact.kind, label: artifact.label, sha256: artifact.sha256 } });
    this.artifacts.unshift(artifact);
    return ArtifactReceipt.parse({ artifact, event });
  }
  async listRunArtifacts(runId: Run["id"]) {
    const id = RunId.parse(runId);
    return this.artifacts.filter((artifact) => artifact.runId === id).slice().reverse();
  }
  async listRunEvents(runId: Run["id"]) {
    const id = RunId.parse(runId);
    return this.events.filter((event) => event.runId === id);
  }
  async heartbeat(input: NodeHeartbeat) {
    const h = NodeHeartbeat.parse(input);
    const node = NodeRecord.parse({
      id: h.nodeId,
      platform: h.platform,
      capabilities: h.capabilities,
      activeRuns: h.activeRuns,
      allowance: h.allowance,
      lastSeenAt: h.observedAt
    });
    this.nodes = [node, ...this.nodes.filter((existing) => existing.id !== node.id)];
  }
  async consumeApproval(_id: ApprovalRequest["id"]): Promise<boolean> {
    throw new Error("MemoryStore does not implement approval consumption");
  }
  async registerProject(input: ProjectRegistration): Promise<ProjectRegistrationResult> {
    const registration = ProjectRegistration.parse(input);
    const existing = this.projects.find(
      (project) => project.repositoryPath === registration.repositoryPath
    );

    if (existing) {
      return ProjectRegistrationResult.parse({ project: existing, created: false });
    }

    const project = Project.parse({
      id: ProjectId.parse(randomUUID()),
      ...registration,
      createdAt: new Date().toISOString()
    });

    this.projects.unshift(project);
    return ProjectRegistrationResult.parse({ project, created: true });
  }
  async createThread(input: ChartRequest) {
    const chart = ChartRequest.parse(input);
    if (!this.projects.some((project) => project.id === chart.projectId)) {
      throw new Error(`Project ${chart.projectId} does not exist`);
    }
    const now = new Date().toISOString();
    const thread = Thread.parse({
      id: ThreadId.parse(randomUUID()),
      ...chart,
      state: ThreadState.enum.planned,
      createdAt: now,
      updatedAt: now
    });
    this.threads.unshift(thread);
    return thread;
  }
  async dispatchThread(input: DispatchRequest) {
    const dispatch = DispatchRequest.parse(input);
    const threadIndex = this.threads.findIndex(
      (thread) => thread.id === dispatch.threadId && thread.state === ThreadState.enum.planned
    );
    const node = this.nodes.find((candidate) => isDispatchableNode(candidate)
      && !this.runs.some((run) => run.assignedNodeId === candidate.id
        && ACTIVE_ASSIGNMENT_RUN_STATES.some((state) => state === run.state)));
    if (threadIndex === -1 || !node) throw new DispatchUnavailableError();

    const currentThread = this.threads[threadIndex];
    const now = new Date().toISOString();
    const thread = Thread.parse({ ...currentThread, state: ThreadState.enum.dispatched, updatedAt: now });
    const payload = DispatchRunPayload.parse({ threadId: thread.id, objective: thread.objective });
    const run = Run.parse({
      id: RunId.parse(randomUUID()),
      projectId: thread.projectId,
      commandId: null,
      state: RunState.enum.queued,
      assignedNodeId: node.id,
      payload,
      createdAt: now,
      updatedAt: now
    });
    const event = RunEvent.parse({
      id: this.events.length + 1,
      runId: run.id,
      type: RunEventType.enum["commission.dispatched"],
      payload: { threadId: thread.id, nodeId: node.id, state: run.state },
      occurredAt: now
    });
    this.threads[threadIndex] = thread;
    this.runs.unshift(run);
    this.events.push(event);
    return DispatchResult.parse({ thread, run, node, event });
  }
  async claimCommission(nodeId: NodeHeartbeat["nodeId"]) {
    const handId = NodeId.parse(nodeId);
    const now = new Date().toISOString();
    const expiredRuns = this.runs.filter((run) => run.state === RunState.enum.claimed && run.leaseExpiresAt
      && Date.parse(run.leaseExpiresAt) <= Date.now());
    for (const expired of expiredRuns) {
      const recovered = Run.parse({
        ...expired,
        state: expired.attempt < expired.maxAttempts ? RunState.enum.queued : RunState.enum.failed,
        assignedNodeId: null,
        leaseExpiresAt: null,
        updatedAt: now
      });
      this.runs[this.runs.indexOf(expired)] = recovered;
      this.events.push(RunEvent.parse({
        id: this.events.length + 1,
        runId: recovered.id,
        type: RunEventType.enum["commission.lease_expired"],
        payload: { state: recovered.state, attempt: recovered.attempt, maxAttempts: recovered.maxAttempts },
        occurredAt: now
      }));
    }
    const runIndex = this.runs.findIndex((run) => (run.assignedNodeId === handId || run.assignedNodeId === null)
      && run.state === RunState.enum.queued && run.attempt < run.maxAttempts);
    if (runIndex === -1) return null;
    const project = this.projects.find((candidate) => candidate.id === this.runs[runIndex].projectId);
    if (!project) throw new Error(`Project ${this.runs[runIndex].projectId} does not exist`);
    const run = Run.parse({ ...this.runs[runIndex], state: RunState.enum.claimed, assignedNodeId: handId,
      attempt: this.runs[runIndex].attempt + 1,
      leaseExpiresAt: new Date(Date.now() + COMMISSION_LEASE_DURATION_MS).toISOString(), updatedAt: now });
    const event = RunEvent.parse({
      id: this.events.length + 1,
      runId: run.id,
      type: RunEventType.enum["commission.claimed"],
      payload: { nodeId: handId, state: run.state, attempt: run.attempt, leaseExpiresAt: run.leaseExpiresAt },
      occurredAt: now
    });
    this.runs[runIndex] = run;
    this.events.push(event);
    return CommissionClaim.parse({ run, project, event });
  }
  async renewCommissionLease(input: CommissionLeaseRenewalInput) {
    const renewal = CommissionLeaseRenewalInput.parse(input);
    const runIndex = this.runs.findIndex((run) => run.id === renewal.runId && run.assignedNodeId === renewal.nodeId
      && run.state === RunState.enum.claimed && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now());
    if (runIndex === -1) throw new CommissionTransitionError();
    const run = Run.parse({ ...this.runs[runIndex],
      leaseExpiresAt: new Date(Date.now() + COMMISSION_LEASE_DURATION_MS).toISOString(), updatedAt: new Date().toISOString() });
    this.runs[runIndex] = run;
    return CommissionLeaseRenewal.parse({ run });
  }
  async cancelCommission(input: CommissionCancellationInput) {
    const cancellation = CommissionCancellationInput.parse(input);
    const runIndex = this.runs.findIndex((run) => run.id === cancellation.runId
      && run.state !== RunState.enum.succeeded && run.state !== RunState.enum.failed && run.state !== RunState.enum.cancelled);
    if (runIndex === -1) throw new CommissionTransitionError();
    const run = Run.parse({ ...this.runs[runIndex], state: RunState.enum.cancelled, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
    const event = await this.appendEvent({ runId: run.id, type: RunEventType.enum["commission.cancelled"],
      payload: { state: run.state, reason: cancellation.reason } });
    this.runs[runIndex] = run;
    return CommissionCancellation.parse({ run, event });
  }
  async retryCommission(input: CommissionRetryInput) {
    const retry = CommissionRetryInput.parse(input);
    const runIndex = this.runs.findIndex((run) => run.id === retry.runId && run.state === RunState.enum.failed && run.attempt < run.maxAttempts);
    if (runIndex === -1) throw new CommissionTransitionError();
    const run = Run.parse({ ...this.runs[runIndex], state: RunState.enum.queued, assignedNodeId: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
    const event = await this.appendEvent({ runId: run.id, type: RunEventType.enum["commission.retried"],
      payload: { state: run.state, attempt: run.attempt, maxAttempts: run.maxAttempts } });
    this.runs[runIndex] = run;
    return CommissionRetry.parse({ run, event });
  }
  async completeCommission(input: CommissionCompletionInput) {
    const completion = CommissionCompletionInput.parse(input);
    const runIndex = this.runs.findIndex((run) => run.id === completion.runId
      && run.assignedNodeId === completion.nodeId && run.state === RunState.enum.claimed
      && run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now());
    if (runIndex === -1) throw new CommissionTransitionError();
    const now = new Date().toISOString();
    const run = Run.parse({ ...this.runs[runIndex], state: completion.state, leaseExpiresAt: null, updatedAt: now });
    const event = RunEvent.parse({
      id: this.events.length + 1,
      runId: run.id,
      type: completion.state === RunState.enum.succeeded
        ? RunEventType.enum["commission.succeeded"]
        : RunEventType.enum["commission.failed"],
      payload: { nodeId: completion.nodeId, state: run.state, exitCode: completion.exitCode },
      occurredAt: now
    });
    this.runs[runIndex] = run;
    this.events.push(event);
    return CommissionCompletion.parse({ run, event });
  }
  async createReport(input: Report) {
    const report = Report.parse(input);
    this.reports.unshift(report);
    return report;
  }
  async close() {}
}
