import { z } from "zod";

export const Id = z.string().uuid();
export const IsoDate = z.string().datetime();
export const ProjectId = Id.brand<"ProjectId">();
export const RunId = Id.brand<"RunId">();
export const NodeId = Id.brand<"NodeId">();
export const CommandId = Id.brand<"CommandId">();
export const ApprovalId = Id.brand<"ApprovalId">();
export const ReportId = Id.brand<"ReportId">();
export const IdeaGraphId = Id.brand<"IdeaGraphId">();
export const PortfolioTransactionId = Id.brand<"PortfolioTransactionId">();
export const IdeaNodeId = z.string().min(1).brand<"IdeaNodeId">();
export const IdempotencyKey = z.string().min(8).brand<"IdempotencyKey">();

export const RUN_STATES = [
  "queued", "waiting_for_allowance", "claimed", "running", "awaiting_approval",
  "succeeded", "failed", "cancelled"
] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "denied", "consumed", "expired"] as const;
export const NODE_PLATFORMS = ["windows", "arch"] as const;
export const ALLOWANCE_STATES = ["available", "limited", "exhausted", "unknown"] as const;
export const REPORT_KINDS = ["project", "daily", "weekly", "validation", "update"] as const;
export const PORTFOLIO_SIDES = ["buy", "sell", "dividend", "fee", "deposit", "withdrawal"] as const;
export const AUTH_MODES = ["development", "passkey"] as const;

export const RunState = z.enum(RUN_STATES);
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);
export const NodePlatform = z.enum(NODE_PLATFORMS);
export const AllowanceState = z.enum(ALLOWANCE_STATES);
export const ReportKind = z.enum(REPORT_KINDS);
export const PortfolioSide = z.enum(PORTFOLIO_SIDES);
export const AuthMode = z.enum(AUTH_MODES);

export const ProjectRegistration = z.object({
  name: z.string().trim().min(1).max(120),
  repositoryPath: z.string().trim().min(1)
});
export const Project = ProjectRegistration.extend({
  id: ProjectId,
  createdAt: IsoDate
});
export const ProjectRegistrationResult = z.object({
  project: Project,
  created: z.boolean()
});

export const CommandEnvelope = z.object({
  id: CommandId,
  projectId: ProjectId,
  command: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  requestedBy: z.string().min(1),
  createdAt: IsoDate,
  idempotencyKey: IdempotencyKey
});
export const RunRequest = CommandEnvelope.pick({
  projectId: true,
  command: true,
  arguments: true
});

export const Run = z.object({
  id: RunId,
  projectId: ProjectId,
  commandId: CommandId.optional(),
  state: RunState,
  assignedNodeId: NodeId.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export const RunSummary = Run.pick({
  id: true,
  state: true,
  createdAt: true
});

export const RunEvent = z.object({
  id: z.number().int().positive(),
  runId: RunId,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: IsoDate
});
export const RunEventInput = RunEvent.pick({
  runId: true,
  type: true,
  payload: true
});

export const ApprovalRequest = z.object({
  id: ApprovalId,
  runId: RunId,
  scope: z.string().min(1),
  reason: z.string().min(1),
  status: ApprovalStatus,
  expiresAt: IsoDate,
  consumedAt: IsoDate.nullable().default(null)
});

const NodeRuntimeState = z.object({
  platform: NodePlatform,
  capabilities: z.array(z.string()),
  activeRuns: z.number().int().nonnegative(),
  allowance: AllowanceState
});
export const NodeHeartbeat = NodeRuntimeState.extend({
  nodeId: NodeId,
  observedAt: IsoDate
});
export const NodeRecord = NodeRuntimeState.extend({
  id: NodeId,
  lastSeenAt: IsoDate
});
export const RunListResponse = z.object({ items: z.array(RunSummary) });
export const NodeListResponse = z.object({ items: z.array(NodeRecord) });

export const Evidence = z.object({
  label: z.string().min(1),
  uri: z.string().min(1),
  capturedAt: IsoDate,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export const Report = z.object({
  id: ReportId,
  projectId: ProjectId,
  kind: ReportKind,
  title: z.string().min(1),
  summary: z.string(),
  evidence: z.array(Evidence),
  generatedAt: IsoDate
});

export const IdeaGraph = z.object({
  id: IdeaGraphId,
  title: z.string().min(1),
  nodes: z.array(z.object({ id: IdeaNodeId, label: z.string(), kind: z.string() })),
  edges: z.array(z.object({ from: IdeaNodeId, to: IdeaNodeId, relation: z.string() })),
  updatedAt: IsoDate
});

export const PortfolioTransaction = z.object({
  id: PortfolioTransactionId,
  occurredOn: z.string().date(),
  account: z.string(),
  asset: z.string(),
  side: PortfolioSide,
  quantity: z.number(),
  unitPrice: z.number().nonnegative().nullable(),
  currency: z.string().length(3),
  source: z.string()
});

export const CostGuardState = z.object({
  mode: z.literal("subscription-only"),
  allowance: AllowanceState,
  directApiEnabled: z.literal(false),
  checkedAt: IsoDate,
  reason: z.string().optional()
});

export type CommandEnvelope = z.infer<typeof CommandEnvelope>;
export type RunRequest = z.infer<typeof RunRequest>;
export type RunState = z.infer<typeof RunState>;
export type Run = z.infer<typeof Run>;
export type RunSummary = z.infer<typeof RunSummary>;
export type RunEvent = z.infer<typeof RunEvent>;
export type RunEventInput = z.infer<typeof RunEventInput>;
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
export type NodeHeartbeat = z.infer<typeof NodeHeartbeat>;
export type Report = z.infer<typeof Report>;
export type IdeaGraph = z.infer<typeof IdeaGraph>;
export type PortfolioTransaction = z.infer<typeof PortfolioTransaction>;
export type CostGuardState = z.infer<typeof CostGuardState>;
export type ProjectRegistration = z.infer<typeof ProjectRegistration>;
export type Project = z.infer<typeof Project>;
export type ProjectRegistrationResult = z.infer<typeof ProjectRegistrationResult>;
export type NodeRecord = z.infer<typeof NodeRecord>;
