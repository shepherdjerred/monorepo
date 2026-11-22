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
  /**
   * What `startedAt` to `finishedAt` measures when it is not the whole
   * action, such as "qualification check" for a build Delivery only checked:
   * the page names it beside the duration.
   */
  spanLabel: z.string().min(1).optional(),
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
  /**
   * An environment stage's accepted release: what Delivery recorded it runs,
   * which `execution` (the newest deployment's release) need not be. Null
   * before the environment accepts one; absent on other stages and on a
   * change's path.
   */
  accepted: z
    .object({
      versionSetId: IdentifierSchema,
      revision: z.number().int().positive(),
    })
    .nullable()
    .optional(),
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
  /** The newest deployment's status; one waiting on a saved-plan decision is `awaiting_approval`. */
  status: PipelineStatusSchema,
  /** The newest deployment failed and locked the environment until an operator recovers it. */
  recoveryRequired: z.boolean(),
  acceptedRevision: z.number().int().positive().nullable(),
  observedAt: TimestampSchema.nullable(),
  approvalRequired: z.boolean(),
  activeDeploymentId: IdentifierSchema.nullable(),
  /**
   * When the newest deployment last moved: its finish, else its request.
   * Null before any deployment; absent from servers that predate it.
   */
  lastDeploymentAt: TimestampSchema.nullable().optional(),
});

export const HubServiceSchema = ServiceSummarySchema.extend({
  latestBuild: BuildViewSchema.nullable(),
  latestExecution: ExecutionSummarySchema.nullable(),
  environments: z.array(HubEnvironmentSchema),
});
export type HubService = z.infer<typeof HubServiceSchema>;

export const AttentionSchema = z.object({
  /**
   * `approval`: a deployment or a saved plan waits for a decision. `failed`:
   * an environment's newest deployment failed, or a new one is queued or
   * running after several failed in a row. `recovery`: it failed and
   * locked the environment. `alarm`: a monitor alarm fired on an accepted
   * release. `queued`: a deployment has waited too long for its first stage.
   * `build_failed`: a service's newest build failed qualification.
   */
  kind: z.enum([
    "approval",
    "failed",
    "recovery",
    "alarm",
    "queued",
    "build_failed",
  ]),
  title: z.string(),
  detail: z.string(),
  at: TimestampSchema.nullable(),
  target: AppTargetSchema,
  /** The service the item is about, so a page can mark where it sits. */
  serviceId: IdentifierSchema,
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
  /**
   * The service, environment and set revision number a deployment, build or
   * version set entry is about, read for the whole page at once. Absent
   * where the list does not read it, null for other entities or a deleted
   * row.
   */
  subject: z
    .object({
      serviceId: IdentifierSchema,
      environmentId: IdentifierSchema.nullable(),
      revision: z.number().int().positive().nullable(),
    })
    .nullable()
    .optional(),
  /**
   * Why a deployment's failure entry failed: the first line of the message
   * the deployment recorded. Absent where the list does not read it and on
   * other actions; null when the deployment recorded none.
   */
  reason: z.string().nullable().optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type ActivitySubject = NonNullable<ActivityEntry["subject"]>;
export const ActivityPageSchema = pageSchema(ActivityEntrySchema);

export const HubOverviewSchema = z.object({
  services: z.array(HubServiceSchema),
  attention: z.array(AttentionSchema),
  activity: z.array(ActivityEntrySchema),
  tools: z.array(LinkSchema),
});
export type HubOverview = z.infer<typeof HubOverviewSchema>;

/**
 * What Delivery last recorded for an environment: the status of its newest
 * deployment, or `not_started` when it has recorded none. A deployment that
 * waits on a saved-plan decision is `awaiting_approval`. This is the
 * deployment record, never live runtime health.
 */
export const GridEnvironmentStatusSchema = z.enum([
  ...DeploymentStatusSchema.options,
  "not_started",
]);
export type GridEnvironmentStatus = z.infer<typeof GridEnvironmentStatusSchema>;

/** An environment's newest deployment, when it is not the one that accepted the selection. */
export const GridRequestSchema = z.object({
  deploymentId: IdentifierSchema,
  /** The revision number of the set revision it deploys. */
  revision: z.number().int().positive(),
});

export const GridEnvironmentSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  /** The newest deployment's status: `request`'s when there is one, else the accepting deployment's. */
  status: GridEnvironmentStatusSchema,
  /**
   * The newest deployment when it differs from the accepting one: in flight,
   * waiting, or ended without being accepted. Null when the newest
   * deployment accepted the selection, or there is none.
   */
  request: GridRequestSchema.nullable(),
  /** When a monitor alarm fired on the accepted release; null while none is firing. */
  alarmedAt: TimestampSchema.nullable(),
  /** The newest deployment left its target quarantined until an operator recovers it. */
  recoveryRequired: z.boolean(),
  /** The accepted set revision's number; null until the environment accepts one. */
  acceptedRevision: z.number().int().positive().nullable(),
  /** When the accepting deployment finished; null when no deployment accepted the selection. */
  acceptedAt: TimestampSchema.nullable(),
  approvalRequired: z.boolean(),
  activeDeploymentId: IdentifierSchema.nullable(),
  /** The environment listed beside this one that it promotes from; null for a first stage. */
  promotesFrom: IdentifierSchema.nullable(),
});
export type GridEnvironment = z.infer<typeof GridEnvironmentSchema>;

/** An active service; `environments` is empty when it has no active environment. */
export const GridServiceSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(1),
  /** Active environments, promotion sources before their targets. */
  environments: z.array(GridEnvironmentSchema),
});
export type GridService = z.infer<typeof GridServiceSchema>;

export const GridGroupSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(1),
  kind: ServiceSummarySchema.shape.kind,
  services: z.array(GridServiceSchema).min(1),
});
export type GridGroup = z.infer<typeof GridGroupSchema>;

/**
 * Every active service by catalog group, in catalog order, with what Delivery
 * last recorded for each of its environments.
 */
export const HubGridSchema = z.object({
  groups: z.array(GridGroupSchema),
  attention: z.array(AttentionSchema),
});
export type HubGrid = z.infer<typeof HubGridSchema>;

export const EnvironmentDetailSchema = z.object({
  environment: EnvironmentSchema,
  service: ServiceSummarySchema,
  pipeline: PipelineRevisionSchema,
  sourceEnvironment: EnvironmentSchema.nullable(),
  /**
   * What a release of a set revision is realised by: the kind of the
   * declared recipe the server freezes (4.12), read by `releaseKindOf` from
   * the stored kind as admission reads it.
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

/**
 * A deployment as a list row: the record plus the revision number of the set
 * revision it deploys, so a list says `r274` without a read per row.
 */
export const DeploymentListItemSchema = DeploymentSchema.extend({
  versionSetRevision: z.number().int().positive(),
});
export type DeploymentListItem = z.infer<typeof DeploymentListItemSchema>;

export const DeploymentPageSchema = pageSchema(DeploymentListItemSchema);

/**
 * The environment page's read of `EnvironmentDetailSchema`: its recent
 * deployments are list rows. The base schema stays as the toolkit reads it,
 * so a toolkit of either age parses a server of either age.
 */
export const EnvironmentPageDetailSchema = EnvironmentDetailSchema.extend({
  deployments: z.array(DeploymentListItemSchema),
  /**
   * The revision number of each set revision the release state names
   * (desired, observed and accepted), read as the deployment list reads its
   * rows', so each reads `r274` even when it is older than `versionSets`.
   */
  releaseRevisions: z
    .array(
      z.object({ id: IdentifierSchema, revision: z.number().int().positive() }),
    )
    .optional(),
});
export type EnvironmentPageDetail = z.infer<typeof EnvironmentPageDetailSchema>;

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
  /** Only entries that record a failure, a refusal or an alarm. */
  problems: z.literal("only").optional(),
  /** Only entries from the last hour or the last day, as the server's clock reads it. */
  within: z.enum(["hour", "day"]).optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

/**
 * How an audit action that records a problem ends: a failure, a refusal, a
 * lapsed lease or approval, an incompatible build, or a monitor alarm.
 */
export const PROBLEM_ACTION_SUFFIXES = [
  "failed",
  "recovery_required",
  "rejected",
  "incompatible",
  "expired",
  "alarmed",
] as const;

/** Whether an audit action records a problem an on-call person looks at. */
export function isProblemAction(action: string) {
  return PROBLEM_ACTION_SUFFIXES.some((suffix) => action.endsWith(suffix));
}

export const ExecutionQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
});

/**
 * Where one change stands in one environment, from the person's point of
 * view. `deploying` means a deployment that would deliver the change (its
 * set revision or a later one that includes it, see `carries`) is queued or
 * running.
 * Every other unfinished state names why nothing is: `recovery_required` (a
 * failed deployment locked the environment), `awaiting_approval`, `failed`,
 * `canceled`, `replaced` (it was deployed, then a release that does not
 * include it, such as a rollback, replaced it), `manual` (it needs a manual promotion or release), `waiting` (the
 * environment it promotes from does not have it yet) and `not_started` (an
 * automatic environment that has started no deployment of it).
 */
export const CommitEnvironmentStateSchema = z.enum([
  "live",
  "superseded",
  "deploying",
  "awaiting_approval",
  "recovery_required",
  "failed",
  "canceled",
  "replaced",
  "manual",
  "waiting",
  "not_started",
]);
export type CommitEnvironmentState = z.infer<
  typeof CommitEnvironmentStateSchema
>;

export const CommitEnvironmentSchema = z.object({
  environmentId: IdentifierSchema,
  name: z.string(),
  state: CommitEnvironmentStateSchema,
  deploymentId: IdentifierSchema.nullable(),
});
export type CommitEnvironment = z.infer<typeof CommitEnvironmentSchema>;

/** The answer to "is it deployed?" for one service, or for a whole commit. */
export const CommitVerdictSchema = z.enum([
  "unknown",
  "building",
  "build_failed",
  "nothing_to_deploy",
  "waiting",
  "deploying",
  "awaiting_approval",
  "recovery_required",
  "failed",
  "deployed",
]);
export type CommitVerdict = z.infer<typeof CommitVerdictSchema>;

export const CommitServiceSchema = z.object({
  service: ServiceSummarySchema,
  build: BuildViewSchema,
  versionSet: z
    .object({ id: IdentifierSchema, revision: z.number().int().positive() })
    .nullable(),
  verdict: CommitVerdictSchema,
  environments: z.array(CommitEnvironmentSchema),
  /**
   * Set when this commit's own build of the service failed and a newer
   * commit's passing build carries the change. With a set or environments,
   * they are the first later release of the service and this is its
   * commit's sha; with neither, no later passing build has a release yet,
   * the build is the failed one, and this is the first later passing commit.
   */
  includedIn: z.string().min(7).optional(),
});
export type CommitService = z.infer<typeof CommitServiceSchema>;

/** One service's standing in one environment. */
export const CommitEnvironmentMemberSchema = z.object({
  serviceId: IdentifierSchema,
  serviceTitle: z.string(),
  environmentId: IdentifierSchema,
  state: CommitEnvironmentStateSchema,
  deploymentId: IdentifierSchema.nullable(),
});

/**
 * Every changed service seen from one environment name, so "is it in prod?"
 * reads as one answer even when a commit touches many services.
 */
export const CommitEnvironmentGroupSchema = z.object({
  name: z.string(),
  verdict: CommitVerdictSchema,
  liveCount: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** Services not yet live first, most urgent first. */
  members: z.array(CommitEnvironmentMemberSchema),
});
export type CommitEnvironmentGroup = z.infer<
  typeof CommitEnvironmentGroupSchema
>;

/** A failed build of a commit, and the later commit that passed and shipped its change. */
export const CarriedFailureSchema = z.object({
  buildId: IdentifierSchema,
  includedIn: z.string().min(7),
});
export type CarriedFailure = z.infer<typeof CarriedFailureSchema>;

export const CommitStatusSchema = z.object({
  sha: z.string().min(7),
  /**
   * First line of the commit message, read from Woodpecker when a build of the
   * commit was qualified. Null when Delivery holds none: the commit predates
   * capture, no build of it has been checked yet, or its message is empty.
   */
  title: z.string().nullable(),
  /** Woodpecker's pipeline author, the forge account behind the push; null as `title` is. */
  author: z.string().nullable(),
  verdict: CommitVerdictSchema,
  /** A build of this commit, for its source panel; null if unseen. */
  buildId: IdentifierSchema.nullable(),
  /** First time Delivery heard of this commit. */
  seenAt: TimestampSchema.nullable(),
  /** The commit seen per environment name, prod first. */
  environments: z.array(CommitEnvironmentGroupSchema),
  /** Services this commit changed, most urgent first. */
  changed: z.array(CommitServiceSchema),
  /** Services whose build passed with nothing to deploy. */
  unchangedCount: z.number().int().nonnegative(),
  /** Builds that failed or are still running, whether or not they changed anything. */
  failedBuilds: z.array(BuildViewSchema),
  /**
   * Failed builds a newer commit carries: for each, the first later main
   * commit whose build of the same service passed and so shipped this
   * commit's change. Such a failure does not decide the verdict.
   */
  carriedFailures: z.array(CarriedFailureSchema).optional(),
  pendingBuilds: z.array(BuildViewSchema),
  /**
   * The most urgent environment of a changed service that does not have the
   * change, prod first among equals, so a page can say what is stuck and
   * where. Null when every one has it.
   */
  blocker: z
    .object({
      service: z.string(),
      environment: z.string(),
      state: CommitEnvironmentStateSchema,
    })
    .nullable(),
});
export type CommitStatus = z.infer<typeof CommitStatusSchema>;

export const CommitSummarySchema = CommitStatusSchema.pick({
  sha: true,
  title: true,
  author: true,
  verdict: true,
  seenAt: true,
  blocker: true,
  carriedFailures: true,
}).extend({
  changedCount: z.number().int().nonnegative(),
  liveCount: z.number().int().nonnegative(),
  environments: z.array(CommitEnvironmentGroupSchema.omit({ members: true })),
  buildId: IdentifierSchema,
  /** How many services' CI failed for this commit, carried or not. */
  failedBuildCount: z.number().int().nonnegative(),
});
export type CommitSummary = z.infer<typeof CommitSummarySchema>;

export const CommitListSchema = pageSchema(CommitSummarySchema);

export const CommitListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
});
export type CommitListQuery = z.infer<typeof CommitListQuerySchema>;
