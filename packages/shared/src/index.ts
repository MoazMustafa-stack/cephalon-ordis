import { z } from "zod";

export const Id = z.string().uuid();
export const IsoDate = z.string().datetime();
export const ProjectRegistration = z.object({
  name: z.string().trim().min(1).max(120),
  repositoryPath: z.string().trim().min(1)
});
export const Project = z.object({
  id: Id,
  name: z.string().min(1),
  repositoryPath: z.string().min(1),
  createdAt: IsoDate
});
export const RunState = z.enum([
  "queued", "waiting_for_allowance", "claimed", "running", "awaiting_approval",
  "succeeded", "failed", "cancelled"
]);

export const CommandEnvelope = z.object({
  id: Id,
  projectId: Id,
  command: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  requestedBy: z.string().min(1),
  createdAt: IsoDate,
  idempotencyKey: z.string().min(8)
});

export const Run = z.object({
  id: Id,
  projectId: Id,
  commandId: Id.optional(),
  state: RunState,
  assignedNodeId: Id.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate
});

export const RunEvent = z.object({
  id: z.number().int().positive(),
  runId: Id,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: IsoDate
});

export const ApprovalRequest = z.object({
  id: Id,
  runId: Id,
  scope: z.string().min(1),
  reason: z.string().min(1),
  status: z.enum(["pending", "approved", "denied", "consumed", "expired"]),
  expiresAt: IsoDate,
  consumedAt: IsoDate.nullable().default(null)
});

export const NodeHeartbeat = z.object({
  nodeId: Id,
  platform: z.enum(["windows", "arch"]),
  capabilities: z.array(z.string()),
  activeRuns: z.number().int().nonnegative(),
  allowance: z.enum(["available", "limited", "exhausted", "unknown"]),
  observedAt: IsoDate
});

export const Evidence = z.object({
  label: z.string().min(1),
  uri: z.string().min(1),
  capturedAt: IsoDate,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export const Report = z.object({
  id: Id,
  projectId: Id,
  kind: z.enum(["project", "daily", "weekly", "validation", "update"]),
  title: z.string().min(1),
  summary: z.string(),
  evidence: z.array(Evidence),
  generatedAt: IsoDate
});

export const IdeaGraph = z.object({
  id: Id,
  title: z.string().min(1),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), relation: z.string() })),
  updatedAt: IsoDate
});

export const PortfolioTransaction = z.object({
  id: Id,
  occurredOn: z.string().date(),
  account: z.string(),
  asset: z.string(),
  side: z.enum(["buy", "sell", "dividend", "fee", "deposit", "withdrawal"]),
  quantity: z.number(),
  unitPrice: z.number().nonnegative().nullable(),
  currency: z.string().length(3),
  source: z.string()
});

export const CostGuardState = z.object({
  mode: z.literal("subscription-only"),
  allowance: z.enum(["available", "limited", "exhausted", "unknown"]),
  directApiEnabled: z.literal(false),
  checkedAt: IsoDate,
  reason: z.string().optional()
});

export type CommandEnvelope = z.infer<typeof CommandEnvelope>;
export type Run = z.infer<typeof Run>;
export type RunEvent = z.infer<typeof RunEvent>;
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
export type NodeHeartbeat = z.infer<typeof NodeHeartbeat>;
export type Report = z.infer<typeof Report>;
export type IdeaGraph = z.infer<typeof IdeaGraph>;
export type PortfolioTransaction = z.infer<typeof PortfolioTransaction>;
export type CostGuardState = z.infer<typeof CostGuardState>;
export type ProjectRegistration = z.infer<typeof ProjectRegistration>;
export type Project = z.infer<typeof Project>;
