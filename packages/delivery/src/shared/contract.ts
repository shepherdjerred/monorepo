import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][\w.:/-]*$/i);
const TimestampSchema = z.iso.datetime();
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SourceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const ArtifactInputSchema = z
  .object({
    id: IdentifierSchema,
    component: IdentifierSchema,
    kind: z.enum(["image", "chart", "archive"]),
    uri: z.string().min(1).max(2048),
    digest: DigestSchema,
    runtimeDigests: z.array(DigestSchema).max(32).default([]),
    requires: z.record(IdentifierSchema, DigestSchema).default({}),
    version: z.string().min(1).max(160),
  })
  .strict();
export const PublishBuildSchema = z
  .object({
    requestId: IdentifierSchema,
    serviceId: IdentifierSchema,
    sourceRevision: SourceRevisionSchema,
    ciUrl: z.url(),
    verifiedAt: TimestampSchema,
    artifacts: z.array(ArtifactInputSchema).min(1).max(100),
  })
  .strict();
export const ArtifactVersionSchema = ArtifactInputSchema.extend({
  serviceId: IdentifierSchema,
  buildId: IdentifierSchema,
  sourceRevision: SourceRevisionSchema,
  createdAt: TimestampSchema,
});
export const BuildSummarySchema = z.object({
  id: IdentifierSchema,
  serviceId: IdentifierSchema,
  sourceRevision: SourceRevisionSchema,
  ciUrl: z.url(),
  status: z.enum(["pending", "verified", "failed"]),
  qualificationReason: z.string().nullable(),
  createdAt: TimestampSchema,
});
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
export const PipelineDefinitionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("argocd"),
      application: IdentifierSchema,
      chartRepository: z.url(),
      chartName: IdentifierSchema,
      chartComponent: IdentifierSchema,
      namespace: IdentifierSchema.optional(),
      parameters: z.record(z.string(), z.string()),
      artifactParameters: z.record(z.string(), IdentifierSchema).default({}),
      verification: z
        .object({
          url: z.url(),
          expectedStatus: z.number().int().min(200).max(299),
        })
        .optional(),
      workerRollout: z
        .object({
          target: z.enum(["central", "scout-beta", "scout-prod"]),
          imageComponent: IdentifierSchema,
          runnerImage: z
            .string()
            .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
      forumRelease: z
        .object({
          imageComponent: IdentifierSchema,
          bundleComponent: IdentifierSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("static-site"),
      archiveComponent: IdentifierSchema,
      bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
      immutablePrefixes: z.array(z.string()).default([]),
      extraExcludes: z.array(z.string()).default([]),
      entrypoints: z.array(z.string().min(1)).min(1).default(["index.html"]),
      verification: z.object({
        url: z.url(),
        expectedStatus: z.number().int().min(200).max(299),
      }),
      cloudflareZoneId: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("manual"), reason: z.string().min(1) }).strict(),
]);
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
export const CreateDeploymentSchema = z
  .object({
    requestId: IdentifierSchema,
    environmentId: IdentifierSchema,
    versionSetRevisionId: IdentifierSchema,
    expectedGeneration: z.number().int().nonnegative(),
    kind: z.enum(["deploy", "promote", "rollback"]).default("deploy"),
    sourceEnvironmentId: IdentifierSchema.optional(),
  })
  .strict();
export const DeploymentSchema = z.object({
  id: IdentifierSchema,
  requestId: IdentifierSchema,
  environmentId: IdentifierSchema,
  serviceId: IdentifierSchema,
  versionSetRevisionId: IdentifierSchema,
  pipelineRevisionId: IdentifierSchema,
  configurationRevision: z.string(),
  configuration: z.record(z.string(), z.string()),
  previousAcceptedVersionSetRevisionId:
    IdentifierSchema.nullable().default(null),
  sourceEnvironmentId: IdentifierSchema.nullable().default(null),
  previousAcceptedConfiguration: z
    .record(z.string(), z.string())
    .nullable()
    .default(null),
  expectedGeneration: z.number().int().nonnegative(),
  kind: z.enum(["deploy", "promote", "rollback"]),
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
export const EvidenceInputSchema = z
  .object({
    kind: z.enum([
      "ci",
      "preflight",
      "backup",
      "migration",
      "reconciliation",
      "runtime",
      "acceptance",
    ]),
    summary: z.string().min(1).max(4000),
    url: z.url().optional(),
    operationId: z.string().min(1).optional(),
  })
  .strict();
export const EvidenceSchema = EvidenceInputSchema.extend({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  createdAt: TimestampSchema,
});
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
  deployment: DeploymentSchema,
  environment: EnvironmentSchema,
  versionSet: VersionSetRevisionSchema,
  previousAcceptedVersionSet: VersionSetRevisionSchema.nullable().default(null),
  pipeline: PipelineRevisionSchema,
  evidence: z.array(EvidenceSchema),
  approvals: z.array(ApprovalSchema),
  stages: z.array(StageSchema),
});
export const OverviewSchema = z.object({
  environments: z.array(EnvironmentSchema),
  deployments: z.array(DeploymentSchema),
  versionSets: z.array(VersionSetRevisionSchema),
  artifacts: z.array(ArtifactVersionSchema),
  builds: z.array(BuildSummarySchema).default([]),
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
export const WorkerRolloutPlanSchema = z
  .object({
    target: z.enum(["central", "scout-beta", "scout-prod"]),
    namespace: z.enum(["beta", "prod"]),
    deploymentName: IdentifierSchema,
    taskQueue: IdentifierSchema,
    candidateBuildId: SourceRevisionSchema,
    candidateImage: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/[\w-]+@sha256:[a-f0-9]{64}$/),
    expectedCurrentBuildId: SourceRevisionSchema,
    deploymentId: IdentifierSchema,
  })
  .strict();
export type WorkerRolloutPlan = z.infer<typeof WorkerRolloutPlanSchema>;
export const WorkerRolloutActionSchema = z.enum([
  "start",
  "advance-50",
  "advance-100",
  "promote",
  "verify",
]);
export type WorkerRolloutAction = z.infer<typeof WorkerRolloutActionSchema>;
export const WorkerRolloutSnapshotSchema = z.object({
  deployment: z.object({ id: IdentifierSchema }),
  pipeline: PipelineRevisionSchema,
  versionSet: VersionSetRevisionSchema,
});
export type WorkerRolloutSnapshot = z.infer<typeof WorkerRolloutSnapshotSchema>;

export function diffVersionSets(
  from: VersionSetRevision | null,
  to: VersionSetRevision,
) {
  const components = [
    ...new Set([
      ...Object.keys(from?.components ?? {}),
      ...Object.keys(to.components),
    ]),
  ].sort();
  return components.flatMap((component) => {
    const before = from?.components[component] ?? null;
    const after = to.components[component] ?? null;
    return before?.id === after?.id ? [] : [{ component, before, after }];
  });
}
