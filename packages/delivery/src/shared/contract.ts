import { z } from "zod";
import { compareVersions } from "./version-diff.ts";
import * as staticSites from "./static-site-contract.ts";
import * as platform from "./platform-contract.ts";
import * as workers from "./worker-contract.ts";
import * as artifacts from "./artifact-contract.ts";
import * as recovery from "./worker-recovery-contract.ts";
import * as evidenceContracts from "./evidence-contract.ts";
import * as minecraftRecovery from "./minecraft-recovery-contract.ts";
import * as minecraftReport from "./minecraft-recovery-report.ts";
import * as controlPlane from "./control-plane-contract.ts";
import * as deploymentRequests from "./deployment-request-contract.ts";
import * as contentRecovery from "./content-recovery-contract.ts";
import * as rollout from "./worker-rollout-contract.ts";
import * as forum from "./forum-contract.ts";
import * as platformRecovery from "./platform-recovery-contract.ts";
import * as pipelines from "./pipeline-contract.ts";
import * as trmnlRepair from "./trmnl-repair-contract.ts";
import * as ownership from "./ownership-contract.ts";
export const RequestContentRecoverySchema =
  contentRecovery.RequestContentRecoverySchema;
export const ContentRecoveryIntentSchema =
  contentRecovery.ContentRecoveryIntentSchema;
export const ContentRecoveryNativeReceiptSchema =
  contentRecovery.ContentRecoveryNativeReceiptSchema;
export const ContentRecoveryOwnershipSchema =
  contentRecovery.ContentRecoveryOwnershipSchema;
export const AdmitContentRecoveryRepairSchema =
  contentRecovery.AdmitContentRecoveryRepairSchema;
export const CompleteContentRecoverySchema =
  contentRecovery.CompleteContentRecoverySchema;
export const ContentBarrierRestorationSchema =
  contentRecovery.ContentBarrierRestorationSchema;
export const DispatchBarrierSchema = contentRecovery.DispatchBarrierSchema;
export type RequestContentRecovery = contentRecovery.RequestContentRecovery;
export type ContentRecoveryIntent = contentRecovery.ContentRecoveryIntent;
export type ContentRecoveryNativeReceipt =
  contentRecovery.ContentRecoveryNativeReceipt;
export type ContentRecoveryOwnership = contentRecovery.ContentRecoveryOwnership;
export type AdmitContentRecoveryRepair =
  contentRecovery.AdmitContentRecoveryRepair;
export type CompleteContentRecovery = contentRecovery.CompleteContentRecovery;
export type ContentBarrierRestoration =
  contentRecovery.ContentBarrierRestoration;
export type DispatchBarrier = contentRecovery.DispatchBarrier;
export const OwnershipHandoverContextSchema =
  ownership.OwnershipHandoverContextSchema;
export const OwnershipHandoverTargetSchema =
  ownership.OwnershipHandoverTargetSchema;
export type OwnershipHandoverContext = ownership.OwnershipHandoverContext;
export type OwnershipHandoverTarget = ownership.OwnershipHandoverTarget;
export const RequestTrmnlRepairSchema = trmnlRepair.RequestTrmnlRepairSchema;
export const TrmnlRepairClaimSchema = trmnlRepair.TrmnlRepairClaimSchema;
export type RequestTrmnlRepair = trmnlRepair.RequestTrmnlRepair;
export type TrmnlRepairClaim = trmnlRepair.TrmnlRepairClaim;
export const RequestPlatformRecoverySchema =
  platformRecovery.RequestPlatformRecoverySchema;
export const PlatformRecoveryIntentSchema =
  platformRecovery.PlatformRecoveryIntentSchema;
export const CompletePlatformRecoverySchema =
  platformRecovery.CompletePlatformRecoverySchema;
export const FailPlatformRecoverySchema =
  platformRecovery.FailPlatformRecoverySchema;
export const PlatformRecoveryPlanReceiptSchema =
  platformRecovery.PlatformRecoveryPlanReceiptSchema;
export const RecordPlatformRecoveryPlanSchema =
  platformRecovery.RecordPlatformRecoveryPlanSchema;
export const PlatformRecoveryNativeReceiptSchema =
  platformRecovery.PlatformRecoveryNativeReceiptSchema;
export const ApprovePlatformRecoveryPlanSchema =
  platformRecovery.ApprovePlatformRecoveryPlanSchema;
export const AdmitPlatformRecoveryApplySchema =
  platformRecovery.AdmitPlatformRecoveryApplySchema;
export type PlatformRecoveryPlanReceipt =
  platformRecovery.PlatformRecoveryPlanReceipt;
export type RecordPlatformRecoveryPlan =
  platformRecovery.RecordPlatformRecoveryPlan;
export type PlatformRecoveryNativeReceipt =
  platformRecovery.PlatformRecoveryNativeReceipt;
export type ApprovePlatformRecoveryPlan =
  platformRecovery.ApprovePlatformRecoveryPlan;
export type AdmitPlatformRecoveryApply =
  platformRecovery.AdmitPlatformRecoveryApply;
export type RequestPlatformRecovery = platformRecovery.RequestPlatformRecovery;
export type PlatformRecoveryIntent = platformRecovery.PlatformRecoveryIntent;
export type CompletePlatformRecovery =
  platformRecovery.CompletePlatformRecovery;
export const PublishForumBundleSchema = forum.PublishForumBundleSchema;
export const QualifiedForumBundleQuerySchema =
  forum.QualifiedForumBundleQuerySchema;
export type QualifiedForumBundleQuery = forum.QualifiedForumBundleQuery;
export const ForumRuntimeStatusSchema = forum.ForumRuntimeStatusSchema;
export const ForumBaselineProofSchema = forum.ForumBaselineProofSchema;
export const RequestForumBaselineSchema = forum.RequestForumBaselineSchema;
export const ForumBaselineIntentSchema = forum.ForumBaselineIntentSchema;
export const ForumBaselineSnapshotSchema = forum.ForumBaselineSnapshotSchema;
export const ForumRecoveredRuntimeSchema = forum.ForumRecoveredRuntimeSchema;
export const CompleteForumBaselineSchema = forum.CompleteForumBaselineSchema;
export const FailForumBaselineSchema = forum.FailForumBaselineSchema;
export type PublishForumBundle = forum.PublishForumBundle;
export type ForumBaselineProof = forum.ForumBaselineProof;
export type RequestForumBaseline = forum.RequestForumBaseline;
export type ForumBaselineIntent = forum.ForumBaselineIntent;
export type ForumBaselineSnapshot = forum.ForumBaselineSnapshot;
export type ForumRecoveredRuntime = forum.ForumRecoveredRuntime;
export type CompleteForumBaseline = forum.CompleteForumBaseline;
export const RequestControlPlaneUpgradeSchema =
  controlPlane.RequestControlPlaneUpgradeSchema;
export const ControlPlaneUpgradeSnapshotSchema =
  controlPlane.ControlPlaneUpgradeSnapshotSchema;
export const ControlPlaneAcceptanceSchema =
  controlPlane.ControlPlaneAcceptanceSchema;
export type RequestControlPlaneUpgrade =
  controlPlane.RequestControlPlaneUpgrade;
export type ControlPlaneUpgradeSnapshot =
  controlPlane.ControlPlaneUpgradeSnapshot;
export const MinecraftRecoveryReportEnvelopeSchema =
  minecraftReport.MinecraftRecoveryReportEnvelopeSchema;
export function parseMinecraftRecoveryReport(input: unknown) {
  return minecraftReport.parseMinecraftRecoveryReport(input);
}
export const RequestMinecraftRecoverySchema =
  minecraftRecovery.RequestMinecraftRecoverySchema;
export const MinecraftRecoveryIntentSchema =
  minecraftRecovery.MinecraftRecoveryIntentSchema;
export const CompleteMinecraftRecoverySchema =
  minecraftRecovery.CompleteMinecraftRecoverySchema;
export const FailMinecraftRecoverySchema =
  minecraftRecovery.FailMinecraftRecoverySchema;
export type RequestMinecraftRecovery =
  minecraftRecovery.RequestMinecraftRecovery;
export type MinecraftRecoveryIntent = minecraftRecovery.MinecraftRecoveryIntent;
export type CompleteMinecraftRecovery =
  minecraftRecovery.CompleteMinecraftRecovery;
export const MinecraftControllerReceiptSchema =
  minecraftRecovery.MinecraftControllerReceiptSchema;
export type MinecraftControllerReceipt =
  minecraftRecovery.MinecraftControllerReceipt;
export const RequestWorkerRecoverySchema = recovery.RequestWorkerRecoverySchema;
export const WorkerRecoveryIntentSchema = recovery.WorkerRecoveryIntentSchema;
export const CompleteWorkerRecoverySchema =
  recovery.CompleteWorkerRecoverySchema;
export const FailWorkerRecoverySchema = recovery.FailWorkerRecoverySchema;
export type RequestWorkerRecovery = recovery.RequestWorkerRecovery;
export type WorkerRecoveryIntent = recovery.WorkerRecoveryIntent;
export type CompleteWorkerRecovery = recovery.CompleteWorkerRecovery;
export const WorkerPoolTargetSchema = workers.WorkerPoolTargetSchema;
export const WorkerHostSpecificationSchema =
  workers.WorkerHostSpecificationSchema;
export const WorkerVersionSchema = workers.WorkerVersionSchema;
export const WorkerPoolStateSchema = workers.WorkerPoolStateSchema;
export const WorkerPoolSnapshotSchema = workers.WorkerPoolSnapshotSchema;
export const RegisterWorkerVersionSchema = workers.RegisterWorkerVersionSchema;
export const RetireWorkerVersionSchema = workers.RetireWorkerVersionSchema;
export const WorkerRetirementClaimSchema = workers.WorkerRetirementClaimSchema;
export type WorkerPoolTarget = workers.WorkerPoolTarget;
export type WorkerHostSpecification = workers.WorkerHostSpecification;
export type WorkerVersion = workers.WorkerVersion;
export type WorkerPoolSnapshot = workers.WorkerPoolSnapshot;
export type RegisterWorkerVersion = workers.RegisterWorkerVersion;
export type RetireWorkerVersion = workers.RetireWorkerVersion;
export type WorkerRetirementClaim = workers.WorkerRetirementClaim;
export function workerHostSpecification(target: WorkerPoolTarget) {
  return workers.workerHostSpecification(target);
}

export const IdentifierSchema = artifacts.IdentifierSchema;
export const ArtifactOriginSchema = artifacts.ArtifactOriginSchema;
export const PlatformChangesSchema = artifacts.PlatformChangesSchema;
export const PlatformReleaseSnapshotSchema =
  platform.PlatformReleaseSnapshotSchema;
export const CreatePlatformDeploymentSchema =
  platform.CreatePlatformDeploymentSchema;
export const TofuPlanReceiptSchema = platform.TofuPlanReceiptSchema;
export const RecordTofuPlanSchema = platform.RecordTofuPlanSchema;
export const EncryptedTofuPlanSchema = platform.EncryptedTofuPlanSchema;
export type PlatformReleaseSnapshot = platform.PlatformReleaseSnapshot;
export type CreatePlatformDeployment = platform.CreatePlatformDeployment;
export type TofuPlanReceipt = platform.TofuPlanReceipt;
export type RecordTofuPlan = platform.RecordTofuPlan;
export type ArtifactOrigin = artifacts.ArtifactOrigin;
export const FindQualifiedArtifactSchema =
  artifacts.FindQualifiedArtifactSchema;
export type FindQualifiedArtifact = artifacts.FindQualifiedArtifact;
export const AcquireUpstreamArtifactSchema =
  artifacts.AcquireUpstreamArtifactSchema;
export const ArtifactAcquisitionSchema = artifacts.ArtifactAcquisitionSchema;
export type AcquireUpstreamArtifact = artifacts.AcquireUpstreamArtifact;
const TimestampSchema = z.iso.datetime();
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ArtifactInputSchema = artifacts.ArtifactInputSchema;
export const PublishBuildSchema = artifacts.PublishBuildSchema;
export const ArtifactVersionSchema = artifacts.ArtifactVersionSchema;
export const LatestQualifiedArtifactQuerySchema = z
  .object({
    serviceId: IdentifierSchema,
    component: IdentifierSchema,
    kind: ArtifactInputSchema.shape.kind,
  })
  .strict();
export type LatestQualifiedArtifactQuery = z.infer<
  typeof LatestQualifiedArtifactQuerySchema
>;
export const BuildSummarySchema = artifacts.BuildSummarySchema;
export const ComposeVersionSetSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: IdentifierSchema,
    baseRevisionId: IdentifierSchema.optional(),
    components: z.record(IdentifierSchema, IdentifierSchema),
  })
  .strict()
  .refine(
    (value) => Object.keys(value.components).length > 0,
    "At least one component is required",
  );
export const VersionSetRevisionSchema = z.object({
  id: IdentifierSchema,
  serviceId: IdentifierSchema,
  revision: z.number().int().positive(),
  baseRevisionId: IdentifierSchema.nullable(),
  components: z.record(z.string(), ArtifactVersionSchema),
  createdAt: TimestampSchema,
});
export const StaticSitePolicySchema = staticSites.StaticSitePolicySchema;
export type StaticSitePolicy = staticSites.StaticSitePolicy;
export const PipelineDefinitionSchema = pipelines.PipelineDefinitionSchema;
export const PipelineRevisionSchema = z.object({
  id: IdentifierSchema,
  definition: PipelineDefinitionSchema,
  createdAt: TimestampSchema,
});
export const RegisterEnvironmentSchema = z
  .object({
    id: IdentifierSchema,
    serviceId: IdentifierSchema,
    name: z.string().min(1).max(100),
    application: IdentifierSchema.optional(),
    pipelineRevisionId: IdentifierSchema,
    configurationRevision: z.string().min(1).max(160),
    configuration: z.record(z.string(), z.string()),
    automatic: z.boolean().default(false),
    promotionSourceEnvironmentId: IdentifierSchema.optional(),
  })
  .strict();
export const EnvironmentSchema = RegisterEnvironmentSchema.extend({
  application: IdentifierSchema.nullable(),
  automaticSuppressedThroughRevision: z.number().int().nonnegative().default(0),
  promotionSourceEnvironmentId: IdentifierSchema.nullable(),
  generation: z.number().int().nonnegative(),
  approvalRequired: z.boolean(),
  desiredVersionSetRevisionId: IdentifierSchema.nullable(),
  observedVersionSetRevisionId: IdentifierSchema.nullable(),
  acceptedVersionSetRevisionId: IdentifierSchema.nullable(),
  acceptedPlatformDeploymentId: IdentifierSchema.nullable().default(null),
  acceptedControlPlaneDeploymentId: IdentifierSchema.nullable().default(null),
  acceptedForumBaselineIntentId: IdentifierSchema.nullable().default(null),
  observedAt: TimestampSchema.nullable(),
  activeDeploymentId: IdentifierSchema.nullable(),
  createdAt: TimestampSchema,
});
export const DeploymentStatusSchema = z.enum([
  "awaiting_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const CreateDeploymentSchema = deploymentRequests.CreateDeploymentSchema;
export const DeploymentSchema = z.object({
  repairOfDeploymentId: IdentifierSchema.nullable().default(null),
  id: IdentifierSchema,
  requestId: IdentifierSchema,
  environmentId: IdentifierSchema,
  serviceId: IdentifierSchema,
  versionSetRevisionId: IdentifierSchema,
  pipelineRevisionId: IdentifierSchema,
  configurationRevision: z.string(),
  configuration: z.record(z.string(), z.string()),
  workerSnapshot: WorkerPoolSnapshotSchema.nullable().default(null),
  platformSnapshot: PlatformReleaseSnapshotSchema.nullable().default(null),
  controlPlaneSnapshot:
    ControlPlaneUpgradeSnapshotSchema.nullable().default(null),
  forumBaselineSnapshot: ForumBaselineSnapshotSchema.nullable().default(null),
  previousAcceptedVersionSetRevisionId:
    IdentifierSchema.nullable().default(null),
  sourceEnvironmentId: IdentifierSchema.nullable().default(null),
  previousAcceptedConfiguration: z
    .record(z.string(), z.string())
    .nullable()
    .default(null),
  expectedGeneration: z.number().int().nonnegative(),
  kind: z.enum([
    "deploy",
    "promote",
    "rollback",
    "retire-worker",
    "upgrade-control-plane",
    "adopt-worker",
    "root-release",
    "tofu-plan",
    "tofu-apply",
    "repair-trmnl",
  ]),
  status: DeploymentStatusSchema,
  automatic: z.boolean().default(false),
  requestedBy: z.string(),
  message: z.string().nullable(),
  cancelRequested: z.boolean(),
  recoveryRequired: z.boolean(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
});
export const EvidenceInputSchema = evidenceContracts.EvidenceInputSchema;
export const EvidenceSchema = evidenceContracts.EvidenceSchema;
export const ApprovalInputSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(1).max(4000),
  })
  .strict();
export const RecoverDeploymentSchema = z
  .object({ operationId: z.uuid(), reason: z.string().min(20).max(4000) })
  .strict();
export const ApprovalSchema = ApprovalInputSchema.extend({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  actor: z.string(),
  createdAt: TimestampSchema,
});
export const StageInputSchema = z
  .object({
    key: IdentifierSchema,
    status: z.enum(["running", "succeeded", "failed"]),
    operationId: z.string().min(1),
    message: z.string().max(4000),
    evidence: z.array(EvidenceInputSchema).default([]),
  })
  .strict();
export const StageSchema = StageInputSchema.omit({ evidence: true }).extend({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  updatedAt: TimestampSchema,
});
export const FinishDeploymentSchema = z
  .object({
    status: z.enum(["succeeded", "failed", "canceled"]),
    message: z.string().min(1).max(4000),
    observedRevisionId: IdentifierSchema.optional(),
    recoveryRequired: z.boolean().default(false),
    evidence: z.array(EvidenceInputSchema).default([]),
  })
  .strict();
export const DeploymentDetailSchema = z.object({
  forumRecoveredRuntime: ForumRecoveredRuntimeSchema.nullable().default(null),
  deployment: DeploymentSchema,
  environment: EnvironmentSchema,
  versionSet: VersionSetRevisionSchema,
  previousAcceptedVersionSet: VersionSetRevisionSchema.nullable().default(null),
  pipeline: PipelineRevisionSchema,
  evidence: z.array(EvidenceSchema),
  approvals: z.array(ApprovalSchema),
  stages: z.array(StageSchema),
  minecraftRecoveries: z.array(MinecraftRecoveryIntentSchema).default([]),
  platformRecoveries: z.array(PlatformRecoveryIntentSchema).default([]),
  contentRecoveries: z
    .array(contentRecovery.ContentRecoveryIntentSchema)
    .default([]),
});
export const ContentRecoveryContextSchema = z.object({
  intent: contentRecovery.ContentRecoveryIntentSchema,
  deployment: DeploymentDetailSchema,
  priorDeployment: DeploymentDetailSchema.nullable(),
  expectedSettlements: contentRecovery.ContentSettlementFingerprintsSchema,
  recoveryHistory: z.array(contentRecovery.ContentRecoveryIntentSchema),
});
export type ContentRecoveryContext = z.infer<
  typeof ContentRecoveryContextSchema
>;
export const WorkerRecoveryContextSchema = z.object({
  intent: WorkerRecoveryIntentSchema,
  deployment: DeploymentDetailSchema,
  pool: WorkerPoolStateSchema,
});
export const MinecraftRecoveryDetailSchema = z.object({
  intent: MinecraftRecoveryIntentSchema,
  deployment: DeploymentDetailSchema,
});
export const ForumBaselineContextSchema = z.object({
  intent: ForumBaselineIntentSchema,
  environment: EnvironmentSchema,
  pipeline: PipelineRevisionSchema,
  image: ArtifactVersionSchema,
  bundle: ArtifactVersionSchema,
});
export type ForumBaselineContext = z.infer<typeof ForumBaselineContextSchema>;
export const PlatformRecoveryContextSchema = z.object({
  intent: PlatformRecoveryIntentSchema,
  deployment: DeploymentDetailSchema,
  expectedSettlements: platformRecovery.PlatformSettlementFingerprintsSchema,
  priorDeployment: DeploymentDetailSchema.nullable(),
  recoveryHistory: z.array(PlatformRecoveryIntentSchema).default([]),
});
export type PlatformRecoveryContext = z.infer<
  typeof PlatformRecoveryContextSchema
>;
export type MinecraftRecoveryDetail = z.infer<
  typeof MinecraftRecoveryDetailSchema
>;
export type WorkerRecoveryContext = z.infer<typeof WorkerRecoveryContextSchema>;
export const OverviewSchema = z.object({
  environments: z.array(EnvironmentSchema),
  deployments: z.array(DeploymentSchema),
  versionSets: z.array(VersionSetRevisionSchema),
  artifacts: z.array(ArtifactVersionSchema),
  builds: z.array(BuildSummarySchema).default([]),
  forumBaselines: z.array(ForumBaselineIntentSchema).default([]),
});
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export const ImportSnapshotSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: IdentifierSchema,
    environmentId: IdentifierSchema.optional(),
    capturedAt: TimestampSchema,
    source: z.enum(["version-catalog", "argocd", "runtime"]),
    components: z.record(
      IdentifierSchema,
      z
        .object({
          uri: z.string().min(1),
          version: z.string().min(1),
          digest: DigestSchema.optional(),
        })
        .strict(),
    ),
    evidence: z.string().min(1).max(4000),
  })
  .strict();
export const ImportedSnapshotSchema = ImportSnapshotSchema.extend({
  id: IdentifierSchema,
  verified: z.literal(false),
  createdAt: TimestampSchema,
});
export const PrincipalSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["human", "machine"]),
  scopes: z.array(
    z.enum(["read", "publish", "deploy", "approve", "execute", "admin"]),
  ),
});

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type VersionSetRevision = z.infer<typeof VersionSetRevisionSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type DeploymentDetail = z.infer<typeof DeploymentDetailSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type PipelineRevision = z.infer<typeof PipelineRevisionSchema>;
export type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>;
export type Principal = z.infer<typeof PrincipalSchema>;
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export type PublishBuild = z.input<typeof PublishBuildSchema>;
export type ComposeVersionSet = z.infer<typeof ComposeVersionSetSchema>;
export type CreateDeployment = z.infer<typeof CreateDeploymentSchema>;
export type RegisterEnvironment = z.infer<typeof RegisterEnvironmentSchema>;
export type StageInput = z.infer<typeof StageInputSchema>;
export type FinishDeployment = z.infer<typeof FinishDeploymentSchema>;
export type ImportSnapshot = z.infer<typeof ImportSnapshotSchema>;
export function deliveryWorkflowId(deploymentId: string) {
  return `delivery/${deploymentId}`;
}
export const WorkerRolloutPlanSchema = rollout.WorkerRolloutPlanSchema;
export type WorkerRolloutPlan = z.infer<typeof WorkerRolloutPlanSchema>;
export const WorkerRolloutActionSchema = rollout.WorkerRolloutActionSchema;
export type WorkerRolloutAction = z.infer<typeof WorkerRolloutActionSchema>;
export const WorkerRolloutSnapshotSchema = z.object({
  deployment: z.object({
    id: IdentifierSchema,
    workerSnapshot: WorkerPoolSnapshotSchema.nullable().default(null),
  }),
  pipeline: PipelineRevisionSchema,
  versionSet: VersionSetRevisionSchema,
});
export type WorkerRolloutSnapshot = z.infer<typeof WorkerRolloutSnapshotSchema>;

export function diffVersionSets(
  from: VersionSetRevision | null,
  to: VersionSetRevision,
) {
  return compareVersions(from, to);
}
