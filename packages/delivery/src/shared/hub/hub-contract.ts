import { z } from "zod";
import { LinkSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  ArtifactVersionSchema,
  BuildSummarySchema,
  IdentifierSchema,
} from "#shared/artifact-contract.ts";
import {
  DeploymentSchema,
  DeploymentStatusSchema,
  EnvironmentSchema,
  PipelineRevisionSchema,
  StageSchema,
  VersionSetRevisionSchema,
} from "#shared/contract.ts";
import { RestoreHoldSchema } from "#shared/model/cold-start-contract.ts";
import { DeploymentKindV2Schema } from "#shared/deployment-request-contract.ts";

const TimestampSchema = z.iso.datetime();

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** One status vocabulary for every stage and action in the pipeline view. */
export const PipelineStatusSchema = z.enum([
  "succeeded",
  "failed",
  "running",
  "pending",
  "queued",
  "awaiting_approval",
  "canceled",
  "not_started",
]);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

/** An in-app destination; the browser builds the route URL from it. */
export const AppTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build"), id: IdentifierSchema }),
  z.object({ kind: z.literal("deployment"), id: IdentifierSchema }),
  z.object({ kind: z.literal("environment"), id: IdentifierSchema }),
  z.object({ kind: z.literal("versionSet"), id: IdentifierSchema }),
]);
export type AppTarget = z.infer<typeof AppTargetSchema>;

export const BuildViewSchema = BuildSummarySchema.extend({
  pipelineNumber: z.number().int().positive().nullable(),
  links: z.array(LinkSchema),
});
export type BuildView = z.infer<typeof BuildViewSchema>;

export const PipelineActionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  status: PipelineStatusSchema,
  detail: z.string().nullable(),
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  target: AppTargetSchema.nullable(),
  links: z.array(LinkSchema),
});
export type PipelineAction = z.infer<typeof PipelineActionSchema>;

export const TransitionSchema = z.object({
  mode: z.enum(["automatic", "manual", "promotion", "approval"]),
  enabled: z.boolean(),
  sourceEnvironmentId: IdentifierSchema.nullable(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const ExecutionRefSchema = z.object({
  buildId: IdentifierSchema.nullable(),
  versionSetId: IdentifierSchema.nullable(),
  revision: z.number().int().positive().nullable(),
  sourceRevision: z.string().nullable(),
});
export type ExecutionRef = z.infer<typeof ExecutionRefSchema>;

export const PipelineStageSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["source", "build", "version", "environment"]),
  title: z.string().min(1),
  status: PipelineStatusSchema,
  execution: ExecutionRefSchema.nullable(),
  environmentId: IdentifierSchema.nullable(),
  transition: TransitionSchema.nullable(),
  actions: z.array(PipelineActionSchema),
});
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const ServiceSummarySchema = z.object({
  id: IdentifierSchema,
  title: z.string(),
  kind: z.enum(["product", "workload", "platform"]),
  links: z.array(LinkSchema),
});
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;

export const ServicePipelineSchema = z.object({
  service: ServiceSummarySchema,
  latestBuild: BuildViewSchema.nullable(),
  stages: z.array(PipelineStageSchema),
});
export type ServicePipeline = z.infer<typeof ServicePipelineSchema>;

export const EnvironmentDeploymentSchema = z.object({
  environmentId: IdentifierSchema,
  deploymentId: IdentifierSchema,
  kind: DeploymentSchema.shape.kind,
  status: DeploymentStatusSchema,
  createdAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
});

export const ExecutionSummarySchema = z.object({
  id: z.string().min(1),
  status: PipelineStatusSchema,
  build: BuildViewSchema.nullable(),
  versionSet: z
    .object({ id: IdentifierSchema, revision: z.number().int().positive() })
    .nullable(),
  deployments: z.array(EnvironmentDeploymentSchema),
  createdAt: TimestampSchema,
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
export const ExecutionPageSchema = pageSchema(ExecutionSummarySchema);

export const TraceDeploymentSchema = DeploymentSchema.extend({
  stages: z.array(StageSchema),
  links: z.array(LinkSchema),
});
export type TraceDeployment = z.infer<typeof TraceDeploymentSchema>;

export const ExecutionTraceSchema = z.object({
  service: ServiceSummarySchema,
  status: PipelineStatusSchema,
  build: BuildViewSchema.nullable(),
  artifacts: z.array(ArtifactVersionSchema),
  versionSet: VersionSetRevisionSchema.nullable(),
  environments: z.array(EnvironmentSchema),
  deployments: z.array(TraceDeploymentSchema),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const HubEnvironmentSchema = z.object({
  id: IdentifierSchema,
  name: z.string(),
  status: PipelineStatusSchema,
  acceptedRevision: z.number().int().positive().nullable(),
  observedAt: TimestampSchema.nullable(),
  approvalRequired: z.boolean(),
  activeDeploymentId: IdentifierSchema.nullable(),
});

export const HubServiceSchema = ServiceSummarySchema.extend({
  latestBuild: BuildViewSchema.nullable(),
  latestExecution: ExecutionSummarySchema.nullable(),
  environments: z.array(HubEnvironmentSchema),
});
export type HubService = z.infer<typeof HubServiceSchema>;

export const AttentionSchema = z.object({
  kind: z.enum(["approval", "failed", "recovery", "build_failed"]),
  title: z.string(),
  detail: z.string(),
  at: TimestampSchema.nullable(),
  target: AppTargetSchema,
});
export type Attention = z.infer<typeof AttentionSchema>;

export const ActivityEntrySchema = z.object({
  id: IdentifierSchema,
  actor: z.string(),
  action: z.string(),
  entityId: z.string(),
  requestId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: TimestampSchema,
  target: AppTargetSchema.nullable(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export const ActivityPageSchema = pageSchema(ActivityEntrySchema);

export const HubOverviewSchema = z.object({
  services: z.array(HubServiceSchema),
  attention: z.array(AttentionSchema),
  activity: z.array(ActivityEntrySchema),
  tools: z.array(LinkSchema),
});
export type HubOverview = z.infer<typeof HubOverviewSchema>;

export const EnvironmentDetailSchema = z.object({
  environment: EnvironmentSchema,
  service: ServiceSummarySchema,
  pipeline: PipelineRevisionSchema,
  sourceEnvironment: EnvironmentSchema.nullable(),
  /** Set by reconcile-after-restore on a mismatch; holds automatic deployments (section 6). */
  restoreHold: RestoreHoldSchema.nullable(),
  /**
   * What a release of a set revision is realised by: the kind of the recipe
   * the server freezes, the accepted selection's until a rebind and the
   * declared one before the first acceptance (E0, L2), read by
   * `releaseKindOf` from the stored kind as admission reads it.
   */
  releaseKind: DeploymentKindV2Schema.extract([
    "deploy",
    "channel-publish",
    "operator-run",
  ]),
  versionSets: z.array(VersionSetRevisionSchema),
  deployments: z.array(DeploymentSchema),
  links: z.array(LinkSchema),
});
export type EnvironmentDetail = z.infer<typeof EnvironmentDetailSchema>;

export const DeploymentPageSchema = pageSchema(DeploymentSchema);

export const BuildWithArtifactsSchema = BuildViewSchema.extend({
  artifacts: z.array(ArtifactVersionSchema),
});
export type BuildWithArtifacts = z.infer<typeof BuildWithArtifactsSchema>;
export const BuildPageSchema = pageSchema(BuildWithArtifactsSchema);

export const DeploymentListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  serviceId: IdentifierSchema.optional(),
  environmentId: IdentifierSchema.optional(),
  status: DeploymentStatusSchema.optional(),
});
export type DeploymentListQuery = z.infer<typeof DeploymentListQuerySchema>;

export const BuildListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  serviceId: IdentifierSchema.optional(),
  status: BuildSummarySchema.shape.status.optional(),
});
export type BuildListQuery = z.infer<typeof BuildListQuerySchema>;

export const ActivityQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  actor: z.string().min(1).max(200).optional(),
  action: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(200).optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ExecutionQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
});
