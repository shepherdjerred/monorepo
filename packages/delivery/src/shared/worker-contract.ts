import { z } from "zod";

const Key = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][\w.:/-]*$/iu);
const Source = z.string().regex(/^[a-f0-9]{40}$/u);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const WorkerPoolTargetSchema = z.enum([
  "central",
  "scout-beta",
  "scout-prod",
]);
export type WorkerPoolTarget = z.infer<typeof WorkerPoolTargetSchema>;
const centralRoute = (namespace: "prod" | "beta") =>
  z
    .object({
      namespace: z.literal(namespace),
      deploymentName: z.literal("monorepo-central-workflows"),
      taskQueue: z.literal("monorepo-workflows"),
    })
    .strict();
const scoutHost = (stage: "beta" | "prod") =>
  z
    .object({
      profile: z.literal(`scout-${stage}-workflows`),
      application: z.literal(`scout-${stage}`),
      kubernetesNamespace: z.literal(`scout-${stage}`),
      routes: z.tuple([
        z
          .object({
            namespace: z.literal(stage),
            deploymentName: z.literal(`scout-${stage}-workflows`),
            taskQueue: z.literal(`scout-${stage}`),
          })
          .strict(),
      ]),
    })
    .strict();
export const WorkerHostSpecificationSchema = z.union([
  z
    .object({
      profile: z.literal("central-workflows"),
      application: z.literal("temporal"),
      kubernetesNamespace: z.literal("temporal"),
      routes: z.tuple([centralRoute("prod"), centralRoute("beta")]),
    })
    .strict(),
  scoutHost("beta"),
  scoutHost("prod"),
]);
export type WorkerHostSpecification = z.infer<
  typeof WorkerHostSpecificationSchema
>;
export function workerHostSpecification(
  target: WorkerPoolTarget,
): WorkerHostSpecification {
  if (target === "central")
    return WorkerHostSpecificationSchema.parse({
      profile: "central-workflows",
      application: "temporal",
      kubernetesNamespace: "temporal",
      routes: ["prod", "beta"].map((namespace) => ({
        namespace,
        deploymentName: "monorepo-central-workflows",
        taskQueue: "monorepo-workflows",
      })),
    });
  const stage = target === "scout-beta" ? "beta" : "prod";
  return WorkerHostSpecificationSchema.parse({
    profile: `scout-${stage}-workflows`,
    application: target,
    kubernetesNamespace: target,
    routes: [
      {
        namespace: stage,
        deploymentName: `scout-${stage}-workflows`,
        taskQueue: target,
      },
    ],
  });
}
export const WorkerVersionSchema = z
  .object({
    id: Key,
    environmentId: Key,
    buildId: Source,
    artifactId: Key,
    artifactBuildId: Key,
    sourceRevision: Source,
    image: z
      .string()
      .regex(
        /^docker\.io\/shepherdjerred\/(?:temporal-worker|scout-for-lol)@sha256:[a-f0-9]{64}$/u,
      ),
    digest: Digest,
    runtimeDigests: z.array(Digest).max(32).default([]),
    introducedByDeploymentId: Key,
    host: WorkerHostSpecificationSchema,
    replicas: z.union([z.literal(0), z.literal(1)]),
    generation: z.number().int().nonnegative(),
    retiredAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine(
    (version) =>
      version.sourceRevision === version.buildId &&
      version.image.endsWith(`@${version.digest}`),
    "Worker source/build and image/digest identities must agree",
  );
export type WorkerVersion = z.infer<typeof WorkerVersionSchema>;
export const WorkerPoolStateSchema = z
  .object({
    environmentId: Key,
    generation: z.number().int().nonnegative(),
    versions: z.array(WorkerVersionSchema).max(1000),
  })
  .strict();
export const WorkerPoolSnapshotSchema = z
  .object({
    schema: z.literal("delivery-worker-pool/v1"),
    environmentId: Key,
    environmentGeneration: z.number().int().nonnegative(),
    target: WorkerPoolTargetSchema,
    candidateBuildId: Source,
    restoredFromDeploymentId: Key.nullable().default(null),
    workerOperation: z
      .enum(["rollout", "retire", "baseline"])
      .default("rollout"),
    retiringWorkerId: Key.nullable().default(null),
    versions: z.array(WorkerVersionSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const ids = new Set<string>();
    const builds = new Set<string>();
    const expected = workerHostSpecification(snapshot.target);
    for (const version of snapshot.versions) {
      if (
        ids.has(version.id) ||
        builds.has(version.buildId) ||
        version.environmentId !== snapshot.environmentId ||
        version.host.profile !== expected.profile
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Worker pool contains duplicate or foreign environment/host identities",
        });
      ids.add(version.id);
      builds.add(version.buildId);
    }
    const candidate = snapshot.versions.find(
      (version) => version.buildId === snapshot.candidateBuildId,
    );
    if (candidate?.replicas !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Worker candidate must have a live frozen host",
      });
    if (
      (snapshot.workerOperation !== "retire") !==
      (snapshot.retiringWorkerId === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Retirement identity must match worker operation",
      });
  });
export type WorkerPoolSnapshot = z.infer<typeof WorkerPoolSnapshotSchema>;
export const RegisterWorkerVersionSchema = z
  .object({
    requestId: Key,
    environmentId: Key,
    expectedGeneration: z.number().int().nonnegative(),
    artifactId: Key,
    introducedByDeploymentId: Key,
    target: WorkerPoolTargetSchema,
  })
  .strict();
export type RegisterWorkerVersion = z.infer<typeof RegisterWorkerVersionSchema>;
const RouteProofBaseSchema = z
  .object({
    namespace: z.enum(["prod", "beta"]),
    deploymentName: Key,
    taskQueue: Key,
    observedAt: z.iso.datetime(),
    currentBuildId: Source,
    rampingBuildId: Source.nullable(),
    openExecutions: z.literal(0),
    routingConflictToken: z.string().min(1).max(2048),
    candidateReferences: z.literal(0),
    canaryReferences: z.literal(0),
  })
  .strict();
const RouteProofSchema = z.union([
  RouteProofBaseSchema.extend({
    drainageStatus: z.literal("DRAINED"),
    deactivationObservedAt: z.iso.datetime(),
    lastDeactivationTime: z.iso.datetime(),
    lastCheckedTime: z.iso.datetime(),
  }),
  RouteProofBaseSchema.extend({
    proofKind: z.literal("inactive-unreferenced"),
    versionStatus: z.literal("INACTIVE"),
    versionCreatedAt: z.iso.datetime(),
    firstActivationTime: z.null(),
    lastCurrentTime: z.null(),
    lastDeactivationTime: z.null(),
    currentSinceTime: z.null(),
    rampingSinceTime: z.null(),
    routingChangedTime: z.null(),
  }),
]);
export const RetireWorkerVersionSchema = z
  .object({
    requestId: Key,
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    expectedWorkerGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type RetireWorkerVersion = z.infer<typeof RetireWorkerVersionSchema>;
export const WorkerRetirementClaimSchema = z
  .object({
    proofs: z.array(RouteProofSchema).min(1).max(2),
  })
  .strict();
export type WorkerRetirementClaim = z.infer<typeof WorkerRetirementClaimSchema>;
