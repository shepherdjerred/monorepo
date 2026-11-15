import {
  WorkerPoolSnapshotSchema,
  workerHostSpecification,
  type DeploymentDetail,
  type WorkerPoolSnapshot,
} from "@shepherdjerred/delivery/contract";
import {
  stepApplicationOf,
  workerRolloutOf,
} from "@shepherdjerred/delivery/model-contract";

/**
 * The rollout a deployment froze, for a v1 `workerRollout` block or a model
 * `worker-rollout` step, with the Application its hosts run in.
 */
export function workerRolloutTarget(
  detail: Pick<DeploymentDetail, "pipeline">,
) {
  const definition = detail.pipeline.definition;
  const rollout = workerRolloutOf(definition);
  const application = stepApplicationOf(definition, "worker-rollout");
  return rollout === undefined || application === null
    ? undefined
    : { ...rollout, application: application.name };
}

export function deliveryWorkerPool(detail: DeploymentDetail) {
  const rollout = workerRolloutTarget(detail);
  if (rollout === undefined) {
    if (detail.deployment.workerSnapshot !== null)
      throw new Error("Non-worker deployment contains a worker pool");
    return;
  }
  const pool = WorkerPoolSnapshotSchema.parse(detail.deployment.workerSnapshot);
  const artifact = detail.versionSet.components[rollout.imageComponent];
  const expectedHost = workerHostSpecification(rollout.target);
  if (
    pool.environmentId !== detail.deployment.environmentId ||
    pool.target !== rollout.target ||
    expectedHost.application !== rollout.application
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

/**
 * The pool a worker stage Job reads: its live hosts only. Delivery keeps every
 * retired host in the frozen pool at zero replicas, so that pool grows with
 * every rollout. No Job reads a retired host: image provenance proves the live
 * images, routing finds the live candidate, a rollback matches the restored
 * live host, and the control-plane proof's chart render fingerprints only
 * control-plane workloads, which no retained host is. Freezing the whole pool
 * into the request made it outgrow the kernel's per-string exec limit.
 */
export function stageWorkerPool(pool: WorkerPoolSnapshot): WorkerPoolSnapshot {
  return {
    ...pool,
    versions: pool.versions.filter((worker) => worker.replicas === 1),
  };
}

/** The deployment as a stage Job reads it, with {@link stageWorkerPool}. */
export function withStageWorkerPool<
  T extends { deployment: { workerSnapshot: WorkerPoolSnapshot | null } },
>(detail: T): T {
  const pool = detail.deployment.workerSnapshot;
  if (pool === null) return detail;
  return {
    ...detail,
    deployment: { ...detail.deployment, workerSnapshot: stageWorkerPool(pool) },
  };
}

/**
 * The pool the worker chart renders: every live host, plus the host a
 * `retire-host` deployment is retiring, at zero replicas, so its own sync
 * scales it down and its step reads the Pods back gone. A host an earlier
 * retirement already scaled to zero is left out. That retirement's accepted
 * proof showed Temporal routes nothing to its build and no open execution is
 * pinned to it, and it has no Pod, so its objects serve nothing; the owned
 * sync prunes them (`workerSyncPrunes`). The Application, which ArgoCD
 * stores whole in etcd with several copies of this parameter, then stays
 * bounded by the live hosts instead of growing with every release. The
 * frozen pool still keeps every retired row, so a rollback or redeploy that
 * raises a retired build renders its host again.
 */
export function renderedWorkerPool(
  pool: WorkerPoolSnapshot,
): WorkerPoolSnapshot {
  return {
    ...pool,
    versions: pool.versions.filter(
      (worker) => worker.replicas === 1 || worker.id === pool.retiringWorkerId,
    ),
  };
}

export function workerPoolParameters(
  detail: DeploymentDetail,
): Record<string, string> {
  const pool = deliveryWorkerPool(detail);
  return pool === undefined
    ? {}
    : {
        "delivery.workerPool": JSON.stringify(renderedWorkerPool(pool)),
      };
}
