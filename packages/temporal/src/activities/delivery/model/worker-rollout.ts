import { ApplicationFailure } from "@temporalio/activity";
import type {
  DeploymentDetail,
  WorkerPoolSnapshot,
  WorkerRolloutAction,
  WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
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
import { recordStage, requireOwned, stageOf } from "./stages.ts";

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
};

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
};

function settled(detail: DeploymentDetail, key: string): boolean {
  return detail.stages.some(
    (stage) => stage.key === key && stage.status === "succeeded",
  );
}

function rolloutPool(detail: DeploymentDetail): WorkerPoolSnapshot | null {
  const pool = deliveryWorkerPool(detail);
  if (pool === undefined) return null;
  if (pool.workerOperation !== "rollout")
    throw new Error("A worker-rollout step rolls out a frozen rollout pool");
  return pool;
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
  const pool = rolloutPool(current);
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
}

/**
 * The worker-rollout step (E5): with the retained hosts synced, prove every
 * host serves its exact image, derive and record the routing plan, promote
 * the candidate, then verify routing reads back on it. Each Job records its
 * own stage first, so a resumed step reattaches to the recorded Job or
 * skips a settled one, and routes by the plan the preflight recorded.
 */
export async function runWorkerRolloutStep(
  current: DeploymentDetail,
  key: string,
  effects: WorkerRolloutEffects = external,
): Promise<void> {
  const pool = rolloutPool(current);
  if (pool === null)
    throw new Error("A worker-rollout step requires its frozen worker pool");
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
