import { WorkerPoolSnapshotSchema } from "#shared/contract.ts";
import type { WorkerVersion } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  artifactView,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import type { Database } from "#infrastructure/database.ts";
import { fingerprint, required } from "#infrastructure/delivery-records.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

/** An observation preserves original publication identity; it never qualifies it. */
export async function workerObservationArtifact(
  database: Transaction | Database,
  artifactId: string,
  repositoryId?: number,
) {
  const row = required(
    await database.artifact.findUnique({
      where: { id: artifactId },
      include: { build: true },
    }),
    "Original observed worker artifact",
  );
  const selected = artifactView(row);
  if (
    row.build.sourceKind !== "ci" ||
    row.build.repositoryId === null ||
    row.build.pipelineNumber === null ||
    (repositoryId !== undefined && row.build.repositoryId !== repositoryId) ||
    selected.origin.kind !== "first-party" ||
    selected.kind !== "image" ||
    selected.runtimeDigests.length === 0
  )
    throw new DeliveryError(
      "INVALID",
      "Observed worker requires original CI image provenance and native runtime digests",
    );
  return selected;
}

function requireObservationStages(
  deploymentId: string,
  stages: { key: string; status: string; operationId: string }[],
) {
  for (const key of [
    "worker-image-provenance",
    "worker-prior-source",
    "worker-baseline",
  ]) {
    const stage = stages.find((entry) => entry.key === key);
    if (
      stage?.status !== "succeeded" ||
      (key === "worker-baseline" &&
        stage.operationId !==
          deliveryOperationId(`${deploymentId}:worker-baseline`))
    )
      throw new DeliveryError(
        "CONFLICT",
        "Observed worker lacks independent native image, source and host evidence",
      );
  }
}

/** Retention of an unqualified original requires its exact independently observed adoption. */
export async function retainedObservedWorkerArtifact(
  database: Transaction | Database,
  worker: WorkerVersion,
  acceptingBaseline = false,
) {
  const published = required(
    await database.artifact.findUnique({
      where: { id: worker.artifactId },
      include: { build: true },
    }),
    "Retained worker artifact",
  );
  if (published.build.status === "verified") return artifactView(published);
  const introduction = required(
    await database.deployment.findUnique({
      where: { id: worker.introducedByDeploymentId },
      include: { stages: true, environment: true },
    }),
    "Observed worker baseline",
  );
  const accepting =
    acceptingBaseline &&
    introduction.status === "running" &&
    introduction.environment.activeDeploymentId === introduction.id;
  const snapshot = WorkerPoolSnapshotSchema.safeParse(
    introduction.workerSnapshot,
  );
  if (
    introduction.kind !== "adopt-worker" ||
    introduction.environmentId !== worker.environmentId ||
    (!accepting && introduction.status !== "succeeded") ||
    !snapshot.success ||
    snapshot.data.workerOperation !== "baseline" ||
    snapshot.data.environmentId !== worker.environmentId
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker lacks a successful observed-only baseline",
    );
  const frozen = snapshot.data.versions.find(
    (version) => version.id === worker.id,
  );
  if (
    frozen === undefined ||
    fingerprint(frozen) !==
      fingerprint({
        ...worker,
        replicas: frozen.replicas,
        generation: frozen.generation,
        retiredAt: frozen.retiredAt,
      })
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker differs from its exact observed baseline identity",
    );
  requireObservationStages(introduction.id, introduction.stages);
  const original = await workerObservationArtifact(database, worker.artifactId);
  if (
    original.buildId !== worker.artifactBuildId ||
    original.sourceRevision !== worker.sourceRevision ||
    `${original.uri}@${original.digest}` !== worker.image ||
    original.digest !== worker.digest ||
    fingerprint(original.runtimeDigests) !== fingerprint(worker.runtimeDigests)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Observed worker original publication identity changed",
    );
  return original;
}
