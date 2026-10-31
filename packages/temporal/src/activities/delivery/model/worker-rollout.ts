import { ApplicationFailure, Context } from "@temporalio/activity";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type WorkerPoolSnapshot,
  type WorkerRolloutAction,
  type WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  deliveryWorkerPool,
  workerRolloutTarget,
} from "#lib/delivery/workers/worker-pool.ts";
import { recordedWorkerPlan } from "#lib/delivery/workers/worker-plan.ts";
import {
  requireLegacyWorkerCoverage,
  workerApplicationResources,
} from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import {
  inspectDeliveryWorkerImages,
  prepareDeliveryWorker,
  stepDeliveryWorker,
} from "#activities/delivery/workers/worker-rollout.ts";
import { requireLiveRoutingCoverage } from "#activities/delivery/workers/worker-bootstrap.ts";
import { verifyWorkerHosts } from "#activities/delivery/workers/worker-hosts.ts";
import { workerRetirementClaim } from "#activities/delivery/workers/worker-claim.ts";
import {
  deploymentPath,
  recordStage,
  requireOwned,
  stageOf,
} from "./stages.ts";

/** The v1 worker Jobs and observations, shared by the model step (E5). */
export type WorkerRolloutEffects = {
  load: (id: string) => Promise<DeploymentDetail>;
  record: typeof recordStage;
  inspectImages: (id: string) => Promise<void>;
  routing: (pool: WorkerPoolSnapshot) => Promise<void>;
  deployments: (application: string) => Promise<unknown[]>;
  hosts: (detail: DeploymentDetail) => Promise<void>;
  prepare: (id: string) => Promise<WorkerRolloutPlan>;
  step: (
    id: string,
    plan: WorkerRolloutPlan,
    action: WorkerRolloutAction,
  ) => Promise<void>;
  /**
   * The v1 retirement fence: a fresh drainage and routing proof the server
   * validates against the frozen retirement under the deployment's locks.
   */
  retirement: (detail: DeploymentDetail) => Promise<void>;
  /** Waits between host readbacks while the retired host's Pods terminate. */
  pause: () => Promise<void>;
};

/** A retired host's Pods terminate after its sync settles; bounded readback. */
const RETIRED_HOST_READBACK_ATTEMPTS = 60;
const RETIRED_HOST_READBACK_INTERVAL_MS = 5000;

const external: WorkerRolloutEffects = {
  load: requireOwned,
  record: recordStage,
  inspectImages: inspectDeliveryWorkerImages,
  routing: requireLiveRoutingCoverage,
  deployments: async (application) =>
    await workerApplicationResources(application, "Deployment", argoRequest),
  hosts: verifyWorkerHosts,
  prepare: prepareDeliveryWorker,
  step: stepDeliveryWorker,
  async retirement(detail) {
    // As v1 does before its sync: the claim names no executor, so the server
    // only re-admits the running retirement against this proof (D7).
    await deliveryRequest(
      `${deploymentPath(detail.deployment.id)}/claim`,
      DeploymentDetailSchema,
      await workerRetirementClaim(detail),
    );
  },
  async pause() {
    Context.current().heartbeat({ stage: "worker-retirement-readback" });
    await Bun.sleep(RETIRED_HOST_READBACK_INTERVAL_MS);
  },
};

function settled(detail: DeploymentDetail, key: string): boolean {
  return detail.stages.some(
    (stage) => stage.key === key && stage.status === "succeeded",
  );
}

/**
 * The frozen pool a worker-rollout step acts on: a rollout promotes its
 * candidate, a `retire-host` deployment scales exactly its retiring host to
 * zero. A baseline adoption never runs the step.
 */
function workerPool(detail: DeploymentDetail): WorkerPoolSnapshot | null {
  const pool = deliveryWorkerPool(detail);
  if (pool === undefined) return null;
  if (
    pool.workerOperation === "baseline" ||
    (pool.workerOperation === "retire") !==
      (detail.deployment.kind === "retire-host")
  )
    throw new Error(
      "A worker-rollout step acts on the frozen rollout or retirement pool of its own deployment kind",
    );
  return pool;
}

/**
 * Before each retirement effect, the Application body write and its sync,
 * the server re-validates a fresh drainage and routing proof of the
 * retiring host, as v1 does before its sync. Any other pool has none.
 */
export async function workerRetirementFence(
  current: DeploymentDetail,
  effects: WorkerRolloutEffects = external,
): Promise<void> {
  if (workerPool(current)?.workerOperation !== "retire") return;
  await effects.retirement(current);
}

/**
 * The worker part of apply-safety, before the Application body is written:
 * the claim captured the prior source, every retained image's baked Build
 * ID is proved (and, for the central pool, the control plane's isolation),
 * every served route reaches a retained host, and no legacy poller remains
 * for the sync to strand. A recipe without a worker-rollout step skips it.
 */
export async function workerRolloutPreflight(
  current: DeploymentDetail,
  effects: WorkerRolloutEffects = external,
): Promise<void> {
  const pool = workerPool(current);
  if (pool === null) return;
  if (!settled(current, "worker-prior-source"))
    throw new Error(
      "The claim records the prior worker source before any worker effect",
    );
  if (!settled(current, "worker-image-provenance"))
    await effects.inspectImages(current.deployment.id);
  await effects.routing(pool);
  const rollout = workerRolloutTarget(current);
  if (rollout === undefined)
    throw new Error("Worker pool has no worker Application");
  if (
    requireLegacyWorkerCoverage(
      await effects.deployments(rollout.application),
      pool,
    )
  )
    throw ApplicationFailure.nonRetryable(
      "Legacy worker pollers still serve this pool; the v1 bootstrap retires them before a model rollout",
      "DeliveryWorkerLegacyPollers",
    );
  await workerRetirementFence(current, effects);
}

/**
 * The worker-rollout step (E5): with the retained hosts synced, prove every
 * host serves its exact image, derive and record the routing plan, promote
 * the candidate, then verify routing reads back on it. Each Job records its
 * own stage first, so a resumed step reattaches to the recorded Job or
 * skips a settled one, and routes by the plan the preflight recorded. A
 * retirement promotes and routes nothing (`settleWorkerRetirement`).
 */
export async function runWorkerRolloutStep(
  current: DeploymentDetail,
  key: string,
  effects: WorkerRolloutEffects = external,
): Promise<void> {
  const pool = workerPool(current);
  if (pool === null)
    throw new Error("A worker-rollout step requires its frozen worker pool");
  if (pool.workerOperation === "retire") {
    await settleWorkerRetirement(current, pool, key, effects);
    return;
  }
  const id = current.deployment.id;
  const operationId = deliveryOperationId(`${id}:worker-rollout`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", { operationId });
  await effects.hosts(current);
  if (!settled(current, "worker-preflight")) await effects.prepare(id);
  let fresh = await effects.load(id);
  const plan = recordedWorkerPlan(fresh);
  for (const action of ["promote", "verify"] as const) {
    if (settled(fresh, `worker-${action}`)) continue;
    await effects.step(id, plan, action);
    fresh = await effects.load(id);
  }
  if (!settled(fresh, "worker-promote") || !settled(fresh, "worker-verify"))
    throw new Error("Worker routing did not settle on the candidate");
  await effects.record(fresh, key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "runtime",
        operationId,
        summary: JSON.stringify({
          adapter: "worker-rollout",
          target: pool.target,
          candidateBuildId: plan.candidateBuildId,
          retained: pool.versions
            .filter((worker) => worker.replicas === 1)
            .map((worker) => worker.buildId),
          routes: plan.routes,
        }),
      },
    ],
  });
}

/**
 * The retirement form of the step. The sync already scaled exactly the
 * retiring host to zero under a fresh drainage proof, so nothing is
 * promoted or routed. It reads back until the retired host has no Pod,
 * terminating ones included, and every retained host serves its exact image
 * with healthy pollers, then proves every served route still reaches a
 * retained host.
 */
async function settleWorkerRetirement(
  current: DeploymentDetail,
  pool: WorkerPoolSnapshot,
  key: string,
  effects: WorkerRolloutEffects,
): Promise<void> {
  const retired = pool.versions.find(
    (worker) => worker.id === pool.retiringWorkerId,
  );
  if (retired?.replicas !== 0)
    throw new Error("A retirement scales exactly its retiring host to zero");
  const id = current.deployment.id;
  const operationId = deliveryOperationId(`${id}:worker-rollout`);
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", { operationId });
  for (let attempt = 1; ; attempt++) {
    try {
      await effects.hosts(current);
      break;
    } catch (error) {
      if (attempt >= RETIRED_HOST_READBACK_ATTEMPTS) throw error;
      await effects.pause();
      // Each readback re-proves ownership; a canceled retirement stops.
      await effects.load(id);
    }
  }
  await effects.routing(pool);
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "runtime",
        operationId,
        summary: JSON.stringify({
          adapter: "worker-retirement",
          target: pool.target,
          retiredBuildId: retired.buildId,
          candidateBuildId: pool.candidateBuildId,
          retained: pool.versions
            .filter((worker) => worker.replicas === 1)
            .map((worker) => worker.buildId),
        }),
      },
    ],
  });
}
