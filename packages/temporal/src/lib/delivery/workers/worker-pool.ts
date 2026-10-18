import {
  WorkerPoolSnapshotSchema,
  workerHostSpecification,
  type DeploymentDetail,
  type WorkerPoolSnapshot,
} from "@shepherdjerred/delivery/contract";

export function deliveryWorkerPool(detail: DeploymentDetail) {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.workerRollout === undefined) {
    if (detail.deployment.workerSnapshot !== null)
      throw new Error("Non-worker deployment contains a worker pool");
    return;
  }
  const pool = WorkerPoolSnapshotSchema.parse(detail.deployment.workerSnapshot);
  const artifact =
    detail.versionSet.components[pipeline.workerRollout.imageComponent];
  const expectedHost = workerHostSpecification(pipeline.workerRollout.target);
  if (
    pool.environmentId !== detail.deployment.environmentId ||
    pool.target !== pipeline.workerRollout.target ||
    expectedHost.application !== pipeline.application
  )
    throw new Error("Worker pool belongs to another deployment target");
  if (
    artifact?.kind !== "image" ||
    (pool.workerOperation !== "baseline" &&
      pool.candidateBuildId !== artifact.sourceRevision)
  )
    throw new Error("Worker pool candidate differs from the selected image");
  validateHosts(pool);
  const candidate = pool.versions.find(
    (worker) => worker.buildId === pool.candidateBuildId,
  );
  if (
    candidate?.replicas !== 1 ||
    (pool.workerOperation !== "baseline" &&
      (candidate.artifactId !== artifact.id ||
        candidate.image !== `${artifact.uri}@${artifact.digest}`))
  )
    throw new Error("Selected candidate has no matching live worker host");
  return pool;
}

function validateHosts(pool: WorkerPoolSnapshot) {
  const expectedHost = workerHostSpecification(pool.target);
  const names = new Set<string>();
  for (const worker of pool.versions) {
    const name = worker.buildId.slice(0, 12);
    if (names.has(name))
      throw new Error("Worker pool has colliding host names");
    names.add(name);
    if (
      worker.environmentId !== pool.environmentId ||
      worker.buildId !== worker.sourceRevision ||
      worker.image !==
        `${pool.target === "central" ? "docker.io/shepherdjerred/temporal-worker" : "docker.io/shepherdjerred/scout-for-lol"}@${worker.digest}` ||
      JSON.stringify(worker.host) !== JSON.stringify(expectedHost)
    )
      throw new Error(
        "Worker host differs from its immutable reviewed profile",
      );
  }
}

export function workerPoolParameters(
  detail: DeploymentDetail,
): Record<string, string> {
  const pool = deliveryWorkerPool(detail);
  return pool === undefined
    ? {}
    : {
        "delivery.workerPool": JSON.stringify(pool),
      };
}
