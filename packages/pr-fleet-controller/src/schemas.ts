import { z } from "zod";

export const PrStatusSchema = z.enum([
  "new",
  "queued",
  "diagnosing",
  "waiting-write-lease",
  "editing",
  "verifying",
  "waiting-ci",
  "waiting-review",
  "paused",
  "green",
  "closed",
]);

export const ClassificationSchema = z.enum([
  "green",
  "pending",
  "actionable-red",
  "conflict",
  "paused",
  "queued",
]);

export const PrIdentitySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  draft: z.boolean(),
  author: z.string(),
  // GitHub author association type. "Bot" lets the review-gate skip policy
  // apply (some providers cannot emit a completion signal for bot authors).
  authorType: z.enum(["Bot", "User"]).default("User"),
  labels: z.array(z.string()),
  headRefName: z.string().min(1),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  baseRefName: z.string().min(1),
  crossRepository: z.boolean(),
  maintainerCanModify: z.boolean(),
});

export const CheckEvidenceSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: z.url().nullable(),
  softFail: z.boolean(),
});

export const ReviewFindingSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  severity: z.enum(["P0", "P1", "P2", "P3", "unknown"]),
  resolved: z.boolean(),
  outdated: z.boolean(),
});

export const BuildkiteFailureSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  state: z.string(),
  webUrl: z.url(),
  startedAt: z.iso.datetime().nullable(),
  log: z.string(),
});

export const ReadinessEvidenceSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  checks: z.array(CheckEvidenceSchema),
  buildkiteCurrentHead: z.boolean(),
  buildkiteFailure: BuildkiteFailureSchema.nullable(),
  conflict: z.boolean(),
  reviewFindings: z.array(ReviewFindingSchema),
  hostedReviewComplete: z.boolean(),
  hardFailureFingerprint: z.string().nullable(),
  reviewFingerprint: z.string().nullable(),
});

export const PrStateSchema = z.object({
  identity: PrIdentitySchema,
  logicalOwner: z.string(),
  runtimeAgent: z.string().nullable(),
  agentGeneration: z.number().int().nonnegative(),
  model: z.string(),
  status: PrStatusSchema,
  classification: ClassificationSchema,
  stackId: z.string(),
  worktree: z.string().nullable(),
  setupComplete: z.boolean(),
  evidence: ReadinessEvidenceSchema,
  lastAgentReportAt: z.iso.datetime().nullable(),
  lastProgressAt: z.iso.datetime(),
  noProgressTicks: z.number().int().nonnegative(),
  prodSentAt: z.iso.datetime().nullable(),
  escalation: z.string().nullable(),
  priority: z.number().int(),
});

export const FleetSnapshotSchema = z.object({
  open: z.number().int().nonnegative(),
  green: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  prs: z.array(PrStateSchema),
});

export const TickTriggerSchema = z.enum([
  "startup",
  "heartbeat",
  "worker-complete",
  "user",
  "due",
]);

export const FleetTickReportSchema = z.object({
  trigger: TickTriggerSchema,
  snapshot: FleetSnapshotSchema,
  changes: z.array(z.string()),
  nextHeartbeatSeconds: z.union([z.literal(300), z.literal(600)]),
});

export const LeaseKindSchema = z.enum(["setup", "heavy", "stack-write"]);

export const WorkerResultSchema = z.object({
  pr: z.number().int().positive(),
  state: z.enum([
    "pushed",
    "green",
    "waiting-ci",
    "waiting-review",
    "needs-setup-lease",
    "needs-heavy-lease",
    "needs-write-lease",
    "blocked",
    "escalation",
  ]),
  headShaBefore: z.string(),
  headShaAfter: z.string().nullable(),
  hardFailures: z.array(z.string()),
  reviewFindings: z.array(z.string()),
  conflict: z.boolean(),
  validation: z.array(z.string()),
  lastAction: z.string(),
  blockers: z.array(z.string()),
  worktree: z.string().nullable(),
  worktreeDirty: z.boolean(),
  setupLeaseReleased: z.boolean(),
  heavyLeaseReleased: z.boolean(),
  writeLeaseReleased: z.boolean(),
});

export const FleetControllerConfigSchema = z.object({
  model: z.string().regex(/^[a-z0-9][\w.-]*\/[^/]+$/i),
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  checkout: z.string().min(1),
  worktreeRoot: z.string().min(1),
  maxWorkers: z.number().int().min(1).max(5),
});

export type PrIdentity = z.infer<typeof PrIdentitySchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type BuildkiteFailure = z.infer<typeof BuildkiteFailureSchema>;
export type ReadinessEvidence = z.infer<typeof ReadinessEvidenceSchema>;
export type PrState = z.infer<typeof PrStateSchema>;
export type FleetSnapshot = z.infer<typeof FleetSnapshotSchema>;
export type FleetTickReport = z.infer<typeof FleetTickReportSchema>;
export type TickTrigger = z.infer<typeof TickTriggerSchema>;
export type LeaseKind = z.infer<typeof LeaseKindSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type FleetControllerConfig = z.infer<typeof FleetControllerConfigSchema>;
