import { workerRolloutOf } from "#shared/model/recipe-view.ts";
import {
  WorkerHostSpecificationSchema,
  WorkerPoolSnapshotSchema,
  WorkerVersionSchema,
  workerHostSpecification,
} from "#shared/contract.ts";
import type {
  ArtifactVersion,
  Environment,
  PipelineRevision,
  WorkerPoolSnapshot,
  WorkerPoolTarget,
  WorkerVersion,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  artifact,
  id,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import type { Database } from "#infrastructure/database.ts";
import { fingerprint, wire } from "#infrastructure/delivery-records.ts";
import { retainedObservedWorkerArtifact } from "./observed.ts";

export async function readWorkerVersions(
  database: Transaction | Database,
  environmentId: string,
) {
  const rows = await database.workerVersion.findMany({
    where: { environmentId },
    orderBy: { buildId: "asc" },
    include: { artifact: { include: { build: true } } },
  });
  const versions = [];
  for (const row of rows) {
    const version = WorkerVersionSchema.parse(
      wire({
        id: row.id,
        environmentId: row.environmentId,
        buildId: row.buildId,
        artifactId: row.artifactId,
        artifactBuildId: row.artifact.buildId,
        sourceRevision: row.artifact.build.sourceRevision,
        image: `${row.artifact.uri}@${row.artifact.digest}`,
        digest: row.artifact.digest,
        runtimeDigests: row.artifact.runtimeDigests,
        introducedByDeploymentId: row.introducedByDeploymentId,
        host: row.host,
        replicas: row.replicas,
        generation: row.generation,
        retiredAt: row.retiredAt,
      }),
    );
    if (row.artifact.build.status !== "verified")
      await retainedObservedWorkerArtifact(database, version);
    versions.push(version);
  }
  return versions;
}

export function workerArtifactIdentity(input: {
  environment: Pick<Environment, "id" | "serviceId" | "application">;
  target: WorkerPoolTarget;
  artifact: ArtifactVersion;
}) {
  const { environment, target, artifact: selected } = input;
  const host = workerHostSpecification(target);
  const serviceId = target === "central" ? "temporal" : "scout-for-lol";
  const repository = target === "central" ? "temporal-worker" : "scout-for-lol";
  if (
    environment.application !== host.application ||
    environment.serviceId !== serviceId ||
    selected.serviceId !== serviceId ||
    selected.kind !== "image" ||
    selected.uri !== `docker.io/shepherdjerred/${repository}`
  )
    throw new DeliveryError(
      "INVALID",
      "Worker image, fixed host profile and environment ownership differ",
    );
  return {
    environmentId: environment.id,
    buildId: selected.sourceRevision,
    artifactId: selected.id,
    artifactBuildId: selected.buildId,
    sourceRevision: selected.sourceRevision,
    image: `${selected.uri}@${selected.digest}`,
    digest: selected.digest,
    runtimeDigests: selected.runtimeDigests,
    host,
  };
}

export function requireSameWorkerIdentity(
  before: WorkerVersion,
  after: WorkerVersion,
) {
  const immutable = ({
    replicas: _replicas,
    generation: _generation,
    retiredAt: _retiredAt,
    ...identity
  }: WorkerVersion) => identity;
  if (fingerprint(immutable(before)) !== fingerprint(immutable(after)))
    throw new DeliveryError(
      "CONFLICT",
      "Environment worker build identity and host specification are immutable",
    );
}

function restoreWorkerPool(
  byBuild: Map<string, WorkerVersion>,
  input: {
    environmentId: string;
    target: WorkerPoolTarget;
    candidateBuildId: string;
    snapshot: WorkerPoolSnapshot;
  },
) {
  const { snapshot } = input;
  if (
    snapshot.environmentId !== input.environmentId ||
    snapshot.target !== input.target ||
    snapshot.candidateBuildId !== input.candidateBuildId
  )
    throw new DeliveryError(
      "CONFLICT",
      "Accepted worker snapshot differs from the rollback target",
    );
  for (const accepted of snapshot.versions) {
    const current = byBuild.get(accepted.buildId);
    if (current === undefined)
      throw new DeliveryError(
        "CONFLICT",
        "Accepted retained worker identity is missing",
      );
    requireSameWorkerIdentity(current, accepted);
    // Only a fresh retirement operation may lower a currently live host.
    byBuild.set(
      accepted.buildId,
      current.replicas === 1 && accepted.replicas === 0 ? current : accepted,
    );
  }
}

export async function freezeWorkerSnapshot(
  tx: Transaction,
  input: {
    environment: Environment;
    pipeline: PipelineRevision;
    versionSet: { components: Record<string, ArtifactVersion> };
    deploymentId: string;
    repositoryId?: number;
    restored?:
      { deploymentId: string; snapshot: WorkerPoolSnapshot } | undefined;
  },
) {
  const { environment: env, pipeline } = input;
  const policy = workerRolloutOf(pipeline.definition);
  if (policy === undefined) return null;
  const selected = input.versionSet.components[policy.imageComponent];
  if (selected === undefined)
    throw new DeliveryError(
      "INVALID",
      "Worker rollout image component is missing",
    );
  const identity = workerArtifactIdentity({
    environment: env,
    target: policy.target,
    artifact: selected,
  });
  const existing = await readWorkerVersions(tx, env.id);
  const byBuild = new Map(existing.map((row) => [row.buildId, row]));
  const restored = input.restored;
  if (restored === undefined) {
    const current = byBuild.get(identity.buildId);
    const candidate = WorkerVersionSchema.parse({
      ...identity,
      id: current?.id ?? id(),
      introducedByDeploymentId:
        current?.introducedByDeploymentId ?? input.deploymentId,
      generation: current?.generation ?? 0,
      replicas: 1,
      retiredAt: null,
    });
    if (current !== undefined) requireSameWorkerIdentity(current, candidate);
    byBuild.set(candidate.buildId, candidate);
  } else {
    restoreWorkerPool(byBuild, {
      environmentId: env.id,
      target: policy.target,
      candidateBuildId: identity.buildId,
      snapshot: restored.snapshot,
    });
  }
  return WorkerPoolSnapshotSchema.parse({
    schema: "delivery-worker-pool/v1",
    environmentId: env.id,
    environmentGeneration: env.generation,
    target: policy.target,
    candidateBuildId: identity.buildId,
    restoredFromDeploymentId: restored?.deploymentId ?? null,
    workerOperation: "rollout",
    retiringWorkerId: null,
    versions: [...byBuild.values()].sort((a, b) =>
      a.buildId.localeCompare(b.buildId),
    ),
  });
}

/** Materialize only identities from the already frozen, owned deployment. */
export async function materializeWorkerSnapshot(
  tx: Transaction,
  snapshot: WorkerPoolSnapshot,
) {
  const rows = await readWorkerVersions(tx, snapshot.environmentId);
  const existing = new Map(rows.map((row) => [row.buildId, row]));
  for (const frozen of snapshot.versions) {
    const current = existing.get(frozen.buildId);
    if (current !== undefined) {
      requireSameWorkerIdentity(current, frozen);
      // Retirements commit desired zero only after runtime acceptance succeeds.
      if (frozen.replicas === 1 && current.replicas === 0)
        await tx.workerVersion.update({
          where: { id: current.id },
          data: { replicas: 1, retiredAt: null, generation: { increment: 1 } },
        });
      continue;
    }
    const original =
      snapshot.workerOperation === "baseline"
        ? await retainedObservedWorkerArtifact(tx, frozen, true)
        : await artifact(tx, frozen.artifactId);
    if (
      original.buildId !== frozen.artifactBuildId ||
      original.sourceRevision !== frozen.buildId ||
      `${original.uri}@${original.digest}` !== frozen.image ||
      frozen.replicas !== 1
    )
      throw new DeliveryError(
        "CONFLICT",
        "Frozen worker identity differs from its qualified original artifact",
      );
    await tx.workerVersion.create({
      data: {
        id: frozen.id,
        environmentId: frozen.environmentId,
        buildId: frozen.buildId,
        artifactId: frozen.artifactId,
        introducedByDeploymentId: frozen.introducedByDeploymentId,
        host: WorkerHostSpecificationSchema.parse(frozen.host),
        replicas: 1,
      },
    });
  }
}
