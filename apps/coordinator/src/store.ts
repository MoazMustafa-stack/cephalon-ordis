import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  ApprovalRequest,
  ApprovalStatus,
  NodeHeartbeat,
  NodeRecord,
  Project,
  ProjectId,
  ProjectRegistration,
  ProjectRegistrationResult,
  Run,
  RunCreateInput,
  RunEvent,
  RunEventInput,
  RunId
} from "@ordis/shared";

export type JsonRecord = Record<string, unknown>;
const TABLE_ORDER = {
  projects: "created_at",
  nodes: "last_seen_at",
  runs: "created_at",
  approval_requests: "expires_at",
  reports: "generated_at",
  idea_graphs: "updated_at",
  portfolio_transactions: "occurred_on"
} as const;
export type StoreTable = keyof typeof TABLE_ORDER;

export interface OrdisStore {
  list(table: StoreTable): Promise<unknown[]>;
  createRun(input: RunCreateInput): Promise<Run>;
  appendEvent(input: RunEventInput): Promise<RunEvent>;
  heartbeat(heartbeat: NodeHeartbeat): Promise<void>;
  consumeApproval(id: ApprovalRequest["id"]): Promise<boolean>;
  registerProject(input: ProjectRegistration): Promise<ProjectRegistrationResult>;
  close(): Promise<void>;
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
    if (table === "nodes") return rows.map((row) => NodeRecord.parse(row));
    if (table === "runs") return rows.map((row) => Run.parse(row));
    if (table === "approval_requests") return rows.map((row) => ApprovalRequest.parse(row));
    return rows;
  }
  async createRun(input: RunCreateInput) {
    const runInput = RunCreateInput.parse(input);
    const result = await this.pool.query(
      `INSERT INTO runs(project_id,command_id,state,payload) VALUES ($1,$2,$3,$4)
       RETURNING id,project_id,command_id,state,assigned_node_id,payload,created_at,updated_at`,
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
  async close() { await this.pool.end(); }
}

export class MemoryStore implements OrdisStore {
  private runs: Run[] = [];
  private events: RunEvent[] = [];
  private nodes: NodeRecord[] = [];
  private projects: Project[] = [];

  async list(table: StoreTable) {
    if (table === "projects") return this.projects;
    if (table === "runs") return this.runs;
    if (table === "nodes") return this.nodes;
    throw new Error(`MemoryStore does not implement list(${table})`);
  }
  async createRun(input: RunCreateInput) {
    const runInput = RunCreateInput.parse(input);
    const now = new Date().toISOString();
    const run = Run.parse({
      id: RunId.parse(randomUUID()),
      ...runInput,
      assignedNodeId: null,
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
  async close() {}
}
