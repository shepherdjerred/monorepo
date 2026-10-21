import {
  WorkerPoolSnapshotSchema,
  WorkerVersionSchema,
  workerHostSpecification,
} from "#shared/contract.ts";
import type {
  CreateDeployment,
  Environment,
  PipelineDefinition,
  PipelineRevision,
  StoredRecipeDefinition,
} from "#shared/contract.ts";
import { workerRolloutOf } from "#shared/model/recipe-view.ts";
import { DeliveryError } from "#domain/error.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";
import { required } from "#infrastructure/delivery-records.ts";
import {
  materializeWorkerSnapshot,
  readWorkerVersions,
  workerArtifactIdentity,
  freezeWorkerSnapshot,
  requireSameWorkerIdentity,
} from "./pool.ts";
import {
  requireWorkerBaselineStages,
  workerObservationArtifact,
} from "./observed.ts";

export async function requireWorkerAdmission(
  tx: Transaction,
  environment: Environment,
  definition: StoredRecipeDefinition,
  kind: string,
) {
  const rollout = workerRolloutOf(definition);
  if (kind === "adopt-worker" || rollout === undefined) return;
  const baseline = await tx.deployment.findFirst({
    where: {
      environmentId: environment.id,
      kind: "adopt-worker",
      status: "succeeded",
      stages: { some: { key: "worker-baseline", status: "succeeded" } },
    },
    include: { stages: true },
    orderBy: { finishedAt: "desc" },
  });
  if (baseline === null)
    throw new DeliveryError(
      "INVALID",
      "Adopt and independently verify the retained worker baseline before requesting a worker rollout",
    );
  requireWorkerBaselineStages(baseline.id, baseline.stages);
  const snapshot = WorkerPoolSnapshotSchema.parse(baseline.workerSnapshot);
  if (
    snapshot.workerOperation !== "baseline" ||
    snapshot.environmentId !== environment.id ||
    snapshot.target !== rollout.target
  )
    throw new DeliveryError(
      "CONFLICT",
      "Accepted worker baseline target differs",
    );
  const current = await readWorkerVersions(tx, environment.id);
  // Original identities remain retained after retirement; later releases may add
  // hosts and change desired replicas without invalidating the initial proof.
  for (const original of snapshot.versions) {
    const retained = current.find((worker) => worker.id === original.id);
    if (retained === undefined)
      throw new DeliveryError(
        "CONFLICT",
        "Accepted baseline worker identity is missing",
      );
    requireSameWorkerIdentity(original, retained);
  }
}

export function freezeWorkerDeployment(
  tx: Transaction,
  input: Parameters<typeof freezeWorkerSnapshot>[1] & {
    baseline: CreateDeployment["workerBaseline"];
  },
) {
  return input.baseline === undefined
    ? freezeWorkerSnapshot(tx, input)
    : freezeWorkerBaseline(tx, { ...input, baseline: input.baseline });
}

export function validateWorkerPipeline(definition: PipelineDefinition) {
  if (definition.kind !== "argocd" || definition.workerRollout === undefined)
    return;
  const policy = definition.workerRollout;
  const host = workerHostSpecification(policy.target);
  const image =
    policy.target === "central" ? "temporal-worker" : "scout-for-lol";
  if (
    definition.application !== host.application ||
    definition.namespace !== host.kubernetesNamespace ||
    definition.chartName !== host.application ||
    definition.chartComponent !== `chart:${host.application}` ||
    policy.imageComponent !== `image:${image}` ||
    definition.artifactParameters[`delivery.images.${image}`] !==
      policy.imageComponent ||
    definition.forumRelease !== undefined ||
    definition.minecraftUpgrade !== undefined
  )
    throw new DeliveryError(
      "INVALID",
      "Worker pipeline must use its reviewed fixed application, namespace, chart and image binding",
    );
}

/** Baseline adoption proves hosts, without claiming the mixed legacy full app is accepted. */
export async function freezeWorkerBaseline(
  tx: Transaction,
  input: {
    environment: Environment;
    pipeline: PipelineRevision;
    deploymentId: string;
    baseline: NonNullable<CreateDeployment["workerBaseline"]>;
    repositoryId?: number;
  },
) {
  const definition = input.pipeline.definition;
  const rollout = workerRolloutOf(definition);
  if (rollout === undefined)
    throw new DeliveryError(
      "INVALID",
      "Host adoption requires a reviewed worker pipeline",
    );
  if (definition.kind === "argocd") validateWorkerPipeline(definition);
  const existing = await readWorkerVersions(tx, input.environment.id);
  if (existing.length > 0)
    throw new DeliveryError(
      "CONFLICT",
      "Initial host-only baseline requires an empty retained worker pool",
    );
  const versions = [];
  for (const artifactId of input.baseline.artifactIds) {
    const selected = await workerObservationArtifact(
      tx,
      artifactId,
      input.repositoryId,
    );
    versions.push(
      WorkerVersionSchema.parse({
        ...workerArtifactIdentity({
          environment: input.environment,
          target: rollout.target,
          artifact: selected,
        }),
        id: id(),
        introducedByDeploymentId: input.deploymentId,
        replicas: 1,
        generation: 0,
        retiredAt: null,
      }),
    );
  }
  const candidate = required(
    versions.find(
      (version) => version.artifactId === input.baseline.candidateArtifactId,
    ) ?? null,
    "Baseline routed artifact",
  );
  return WorkerPoolSnapshotSchema.parse({
    schema: "delivery-worker-pool/v1",
    environmentId: input.environment.id,
    environmentGeneration: input.environment.generation,
    target: rollout.target,
    candidateBuildId: candidate.buildId,
    workerOperation: "baseline",
    retiringWorkerId: null,
    restoredFromDeploymentId: null,
    versions,
  });
}

export async function acceptWorkerBaseline(
  tx: Transaction,
  deployment: { id: string; kind: string; workerSnapshot: unknown },
) {
  if (deployment.kind !== "adopt-worker") return;
  const snapshot = WorkerPoolSnapshotSchema.parse(deployment.workerSnapshot);
  if (snapshot.workerOperation !== "baseline")
    throw new DeliveryError(
      "INVALID",
      "Worker baseline operation differs from its frozen snapshot",
    );
  const stage = await tx.stage.findUnique({
    where: {
      deploymentId_key: { deploymentId: deployment.id, key: "worker-baseline" },
    },
  });
  if (stage?.status !== "succeeded")
    throw new DeliveryError(
      "INVALID",
      "Worker baseline requires independently observed host, image configuration and routing evidence",
    );
  requireWorkerBaselineStages(
    deployment.id,
    await tx.stage.findMany({ where: { deploymentId: deployment.id } }),
  );
  await materializeWorkerSnapshot(tx, snapshot);
}
