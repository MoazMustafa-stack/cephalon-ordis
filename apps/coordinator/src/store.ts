import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { NodeHeartbeat, Project, Run, RunEvent } from "@ordis/shared";

export type JsonRecord = Record<string, unknown>;
export type ProjectRegistrationResult = {
  project: Project;
  created: boolean;
};

export interface OrdisStore {
  list(table: "projects" | "nodes" | "runs" | "approval_requests" | "reports" | "idea_graphs" | "portfolio_transactions"): Promise<unknown[]>;
  createRun(projectId: string, state: Run["state"], payload: JsonRecord): Promise<Run>;
  appendEvent(runId: string, type: string, payload?: JsonRecord): Promise<RunEvent>;
  heartbeat(heartbeat: NodeHeartbeat): Promise<void>;
  consumeApproval(id: string): Promise<boolean>;
  registerProject(name: string, repositoryPath: string): Promise<ProjectRegistrationResult>;
  close(): Promise<void>;
}

const camel = (row: JsonRecord): JsonRecord => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value instanceof Date ? value.toISOString() : value])
);

export class PgStore implements OrdisStore {
  constructor(private readonly pool: Pool) {}
  static connect(connectionString: string) { return new PgStore(new Pool({ connectionString })); }

  async list(table: Parameters<OrdisStore["list"]>[0]) {
    const result = await this.pool.query(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 200`);
    return result.rows.map(camel);
  }
  async createRun(projectId: string, state: Run["state"], payload: JsonRecord) {
    const result = await this.pool.query(
      `INSERT INTO runs(project_id,state,payload) VALUES ($1,$2,$3) RETURNING id,project_id,state,assigned_node_id,created_at,updated_at`,
      [projectId, state, payload]
    );
    return camel(result.rows[0]) as Run;
  }
  async appendEvent(runId: string, type: string, payload: JsonRecord = {}) {
    const result = await this.pool.query(
      `INSERT INTO run_events(run_id,type,payload) VALUES ($1,$2,$3) RETURNING id,run_id,type,payload,occurred_at`,
      [runId, type, payload]
    );
    return camel(result.rows[0]) as RunEvent;
  }
  async heartbeat(h: NodeHeartbeat) {
    await this.pool.query(
      `INSERT INTO nodes(id,platform,capabilities,allowance,active_runs,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET platform=excluded.platform, capabilities=excluded.capabilities,
       allowance=excluded.allowance, active_runs=excluded.active_runs, last_seen_at=excluded.last_seen_at`,
      [h.nodeId, h.platform, JSON.stringify(h.capabilities), h.allowance, h.activeRuns, h.observedAt]
    );
  }
  async consumeApproval(id: string) {
    const result = await this.pool.query(
      `UPDATE approval_requests SET status='consumed',consumed_at=now()
       WHERE id=$1 AND status='approved' AND consumed_at IS NULL AND expires_at>now() RETURNING id`, [id]
    );
    return result.rowCount === 1;
  }
  async registerProject(name: string, repositoryPath: string): Promise<ProjectRegistrationResult> {
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
      [name, repositoryPath]
    );

    const row = camel(result.rows[0]) as Project & { created: boolean };

    return {
      project: {
        id: row.id,
        name: row.name,
        repositoryPath: row.repositoryPath,
        createdAt: row.createdAt
      },
      created: row.created
    };
  }
  async close() { await this.pool.end(); }
}

export class MemoryStore implements OrdisStore {
  private runs: Run[] = [];
  private events: RunEvent[] = [];
  private nodes: NodeHeartbeat[] = [];
  private projects: Project[] = [];

  async list(table: Parameters<OrdisStore["list"]>[0]) {
    if (table === "projects") return this.projects;
    if (table === "runs") return this.runs;
    if (table === "nodes") return this.nodes;
    return [];
  }
  async createRun(projectId: string, state: Run["state"]) {
    const now = new Date().toISOString();
    const run: Run = { id: randomUUID(), projectId, state, assignedNodeId: null, createdAt: now, updatedAt: now };
    this.runs.unshift(run);
    return run;
  }
  async appendEvent(runId: string, type: string, payload: JsonRecord = {}) {
    const event: RunEvent = { id: this.events.length + 1, runId, type, payload, occurredAt: new Date().toISOString() };
    this.events.push(event);
    return event;
  }
  async heartbeat(h: NodeHeartbeat) { this.nodes = [h, ...this.nodes.filter((n) => n.nodeId !== h.nodeId)]; }
  async consumeApproval() { return false; }
  async registerProject(name: string, repositoryPath: string): Promise<ProjectRegistrationResult> {
    const existing = this.projects.find(
      (project) => project.repositoryPath === repositoryPath
    );

    if (existing) {
      return { project: existing, created: false };
    }

    const project: Project = {
      id: randomUUID(),
      name,
      repositoryPath,
      createdAt: new Date().toISOString()
    };

    this.projects.unshift(project);
    return { project, created: true };
  }
  async close() {}
}
