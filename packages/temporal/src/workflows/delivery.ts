import {
  ApplicationFailure,
  CancellationScope,
  isCancellation,
  patched,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { PendingReplication } from "@shepherdjerred/delivery/artifact-contract";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import type { PlatformDeliveryActivities } from "#activities/delivery/platform/index.ts";
import type { DeliveryReplicationActivities } from "#activities/delivery/replication/copy.ts";
import type { DeliveryColdStartActivities } from "#activities/delivery/model/cold-start.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const mutation = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  // The single Temporal server can briefly restart during an owned release.
  // Keep heartbeats/cancellation active without expiring effects during that gap.
  heartbeatTimeout: "5 minutes",
  // A worker crash or lost subprocess receipt requires inspection, not a repeat write.
  retry: { maximumAttempts: 1 },
});
const observation = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    maximumInterval: "30 seconds",
  },
});
const jobs = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "135 minutes",
  heartbeatTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});
const qualification = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const platform = proxyActivities<PlatformDeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
  startToCloseTimeout: "135 minutes",
  heartbeatTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});
const controlPlane = proxyActivities<PlatformDeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
  startToCloseTimeout: "135 minutes",
  scheduleToCloseTimeout: "150 minutes",
  heartbeatTimeout: "5 minutes",
  // Continuations inspect the same persisted native Job UID; they never repeat a missing Job.
  retry: {
    maximumAttempts: 10,
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
/** Off-cluster writes run on the backup worker, which holds the R2 credentials. */
const backup = proxyActivities<DeliveryColdStartActivities>({
  taskQueue: TASK_QUEUES.BACKUP,
  scheduleToCloseTimeout: "10 minutes",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 5, initialInterval: "10 seconds" },
});
/**
 * The cold-start snapshot of an acceptance retries until it lands: the
 * deployment is already terminal, and nothing else revisits it to write the
 * snapshot (X7). Each write is idempotent and never moves `latest.json` back.
 */
const coldStartBackup = proxyActivities<DeliveryColdStartActivities>({
  taskQueue: TASK_QUEUES.BACKUP,
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "10 seconds", maximumInterval: "10 minutes" },
});
const replication = proxyActivities<DeliveryReplicationActivities>({
  taskQueue: TASK_QUEUES.BACKUP,
  // The backup worker runs one Activity at a time and the dispatch Workflow
  // has a five-minute execution budget: a running snapshot defers replication
  // to a later tick instead of holding this one. The copy is idempotent, so the
  // next tick retries instead of this one.
  scheduleToStartTimeout: "1 minute",
  scheduleToCloseTimeout: "3 minutes",
  startToCloseTimeout: "3 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});

/**
 * Dispatch ticks started before replication existed replay without it: the
 * worker auto-upgrades open executions, and those histories begin with the
 * qualification and dispatch Activities.
 */
export const DELIVERY_REPLICATION_PATCH = "delivery-dispatch-replication-v1";

/**
 * Deployments of model recipes run the step executor (T3). Histories recorded
 * before it never reach this branch: their prepare result carries no `model`.
 */
export const DELIVERY_MODEL_EXECUTOR_PATCH = "delivery-model-executor-v1";

/**
 * Once per dispatch tick: monitors and self-heal drift are observed and
 * removed environments' Applications are deleted (4.19, T4, 4.10). Ticks
 * recorded before them replay without these Activities.
 */
export const DELIVERY_DISPATCH_MODEL_PATCH = "delivery-dispatch-model-v1";

/**
 * An acceptance's cold-start write retries until it lands (X7). Histories
 * recorded before it keep their bounded five attempts.
 */
export const DELIVERY_COLD_START_RETRY_PATCH = "delivery-cold-start-retry-v1";

/**
 * D8: a self-hosted service's outgoing executor hands off after applying
 * instead of accepting; its successor verifies and finishes. Histories
 * recorded before it accept as they always did.
 */
export const DELIVERY_SELF_HOSTED_HANDOFF_PATCH =
  "delivery-self-hosted-handoff-v1";

/** Artifacts replicated per dispatch tick; the rest wait for the next one. */
const REPLICATIONS_PER_DISPATCH = 10;

function replicatedStoreObject(uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/u.exec(uri);
  const bucket = match?.[1];
  const key = match?.[2];
  if (bucket === undefined || key === undefined)
    throw ApplicationFailure.nonRetryable(
      `Artifact awaiting replication is not an s3 object: ${uri}`,
      "DeliveryReplicationUri",
    );
  return { bucket, key };
}

function hexSha256(digest: string): string {
  if (!digest.startsWith("sha256:"))
    throw ApplicationFailure.nonRetryable(
      `Artifact awaiting replication has a non-sha256 digest: ${digest}`,
      "DeliveryReplicationDigest",
    );
  return digest.slice("sha256:".length);
}

async function replicateArtifact(
  artifact: PendingReplication["artifacts"][number],
): Promise<void> {
  const { bucket, key } = replicatedStoreObject(artifact.uri);
  const replica = await replication.replicateDeliveryObject({
    sourceBucket: bucket,
    sourceKey: key,
    expectedSha256: hexSha256(artifact.digest),
  });
  await qualification.recordDeliveryReplication({
    artifactId: artifact.artifactId,
    replication: {
      store: "r2",
      bucket: replica.backupBucket,
      key: replica.backupObjectKey,
      digest: `sha256:${replica.sha256}`,
      replicatedAt: new Date().toISOString(),
    },
  });
}

/** One artifact's failure never stops the others; every failure is returned. */
async function replicatePendingArtifacts(): Promise<unknown[]> {
  let pending: PendingReplication;
  try {
    pending = await qualification.listDeliveryReplications();
  } catch (error: unknown) {
    return [error];
  }
  const outcomes = await Promise.allSettled(
    pending.artifacts
      .slice(0, REPLICATIONS_PER_DISPATCH)
      .map((artifact) => replicateArtifact(artifact)),
  );
  const failures: unknown[] = [];
  for (const outcome of outcomes)
    if (outcome.status === "rejected") failures.push(outcome.reason);
  return failures;
}

type Ready = Extract<
  Awaited<ReturnType<DeliveryActivities["prepareDelivery"]>>,
  { status: "ready" }
>;

/** TRMNL repair, control-plane and platform releases run one Activity each. */
async function specializedRelease(deploymentId: string, ready: Ready) {
  if (ready.trmnlRepair)
    return await mutation.applyDeliveryTrmnlPlugins(deploymentId);
  if (ready.controlPlane)
    return await controlPlane.executeDeliveryControlPlane(deploymentId);
  return ready.platform
    ? await platform.executeDeliveryPlatform(deploymentId)
    : null;
}

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  let claimed = false;
  try {
    let ready = await metadata.prepareDelivery(input.deploymentId);
    while (ready.status === "waiting") {
      await sleep("30 seconds");
      ready = await metadata.prepareDelivery(input.deploymentId);
    }
    if (ready.status === "terminal") return;
    claimed = true;
    if (ready.model && patched(DELIVERY_MODEL_EXECUTOR_PATCH)) {
      const outcome = await runModelRecipe(input.deploymentId);
      // The result is recorded, or the successor owns it now (D8); nothing
      // after this may rewrite it.
      claimed = false;
      await settleModelAcceptance(input.deploymentId, outcome);
      return;
    }
    const specialized = await specializedRelease(input.deploymentId, ready);
    if (specialized !== null) {
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence: specialized,
      });
      return;
    }
    if (ready.workerHosts)
      await jobs.inspectDeliveryWorkerImages(input.deploymentId);
    if (ready.minecraftUpgrade) {
      let preservation = await jobs.preserveDeliveryMinecraft(
        input.deploymentId,
      );
      while (preservation.status === "waiting") {
        await sleep("30 seconds");
        preservation = await jobs.preserveDeliveryMinecraft(input.deploymentId);
      }
    }
    await mutation.applyDelivery(input.deploymentId);
    if (ready.workerRollout) {
      const plan = await jobs.prepareDeliveryWorker(input.deploymentId);
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "promote");
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "verify");
    }
    const evidence = await observation.verifyDelivery(input.deploymentId);
    if (ready.scoutSite)
      evidence.push(
        ...(await mutation.applyDeliveryScoutSite(input.deploymentId)),
      );
    if (ready.trmnlPlugins)
      evidence.push(
        ...(await mutation.applyDeliveryTrmnlPlugins(input.deploymentId)),
      );
    await metadata.finishDelivery(input.deploymentId, {
      status: "succeeded",
      evidence,
    });
  } catch (error) {
    if (!claimed) throw error;
    await CancellationScope.nonCancellable(async () => {
      await metadata.finishDelivery(input.deploymentId, {
        status: isCancellation(error) ? "canceled" : "failed",
        evidence: [],
      });
    });
    throw error;
  }
}

/**
 * The step iterator (T3): each frozen step from the first unsettled one,
 * renewing the lease first; every step records its intent before its effect.
 */
async function runModelRecipe(
  deploymentId: string,
): Promise<"accepted" | "handed-off"> {
  const plan = await metadata.planDeliveryModel(deploymentId);
  // Tofu steps hold platform authority and run on the platform queue.
  const run = async (key: string) =>
    plan.platform.includes(key)
      ? await platform.runDeliveryModelPlatformStep(deploymentId, key)
      : await jobs.runDeliveryModelStep(deploymentId, key);
  for (const key of plan.keys.slice(plan.resumeAt)) {
    await metadata.renewDeliveryLease(deploymentId);
    let step = await run(key);
    // Operator-run and approve steps wait for a person outside the executor.
    while (step.waiting) {
      await sleep("1 minute");
      await metadata.renewDeliveryLease(deploymentId);
      step = await run(key);
    }
  }
  // D8: the applied change may replace this executor; leave the deployment
  // owned with a frozen lease for the successor, which verifies acceptance.
  if (plan.handoff && patched(DELIVERY_SELF_HOSTED_HANDOFF_PATCH)) {
    await metadata.handOffDelivery(deploymentId);
    return "handed-off";
  }
  const evidence = await observation.acceptDeliveryModel(deploymentId);
  await metadata.finishDelivery(deploymentId, {
    status: "succeeded",
    evidence,
  });
  return "accepted";
}

/**
 * D8: the successor executor of a handed-off self-hosted deployment. It
 * claims the handoff marker before anything else, then verifies acceptance
 * from the frozen record and finishes it. If it cannot, the deployment ends
 * recovery-required with its locks and the dispatch barrier held.
 */
export async function deliveryHandoffWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  await metadata.claimDeliveryHandoff(input.deploymentId);
  try {
    const evidence = await observation.acceptDeliveryModel(input.deploymentId);
    await metadata.finishDelivery(input.deploymentId, {
      status: "succeeded",
      evidence,
    });
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryHandoff(input.deploymentId);
    });
    throw error;
  }
  await settleModelAcceptance(input.deploymentId, "accepted");
}

/** After acceptance: self-heal on the accepted source and the cold-start snapshot (T4, X7). */
async function settleModelAcceptance(
  deploymentId: string,
  outcome: "accepted" | "handed-off",
) {
  // A handed-off deployment is settled by its successor (D8).
  if (outcome === "handed-off") return;
  const coldStart = await metadata.settleDeliveryModel(deploymentId);
  if (coldStart === null) return;
  const writer = patched(DELIVERY_COLD_START_RETRY_PATCH)
    ? coldStartBackup
    : backup;
  await metadata.recordDeliveryColdStart(
    deploymentId,
    await writer.writeDeliveryColdStart(coldStart),
  );
}

/** Every observation runs whatever dispatch did; failures surface after it. */
async function observeAcceptedSelections(): Promise<unknown[]> {
  const outcomes = await Promise.allSettled([
    observation.observeDeliveryMonitors(),
    observation.observeDeliveryDrift(),
    observation.removeDeliveryTargets(),
  ]);
  const failures: unknown[] = [];
  for (const outcome of outcomes)
    if (outcome.status === "rejected") failures.push(outcome.reason);
  return failures;
}

export async function deliveryDispatchWorkflow() {
  // Receipts land before qualification so a build verifies in the same tick;
  // dispatch still runs when replication fails and the failure surfaces last.
  const replicationFailures = patched(DELIVERY_REPLICATION_PATCH)
    ? await replicatePendingArtifacts()
    : [];
  const [
    qualified,
    dispatched,
    recovered,
    minecraftRecovered,
    forumQualified,
    forumBaseline,
    platformRecovered,
  ] = await Promise.allSettled([
    qualification.qualifyDeliveryBuilds(),
    metadata.dispatchPendingDeliveries(),
    metadata.dispatchDeliveryWorkerRecoveries(),
    metadata.dispatchDeliveryMinecraftRecoveries(),
    qualification.qualifyDeliveryForumBundles(),
    metadata.dispatchDeliveryForumBaselines(),
    metadata.dispatchDeliveryPlatformRecoveries(),
  ]);
  const observationFailures = patched(DELIVERY_DISPATCH_MODEL_PATCH)
    ? await observeAcceptedSelections()
    : [];
  if (dispatched.status === "rejected") throw dispatched.reason;
  if (qualified.status === "rejected") throw qualified.reason;
  if (recovered.status === "rejected") throw recovered.reason;
  if (minecraftRecovered.status === "rejected") throw minecraftRecovered.reason;
  if (forumQualified.status === "rejected") throw forumQualified.reason;
  if (forumBaseline.status === "rejected") throw forumBaseline.reason;
  if (platformRecovered.status === "rejected") throw platformRecovered.reason;
  if (replicationFailures.length > 0) throw replicationFailures[0];
  if (observationFailures.length > 0) throw observationFailures[0];
  return dispatched.value;
}

export async function deliveryPlatformRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await platform.inspectDeliveryPlatformRecovery(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryPlatformRecovery(input.intentId);
    });
    throw error;
  }
}

export async function deliveryWorkerRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await observation.inspectDeliveryWorkerRecovery(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryWorkerRecovery(input.intentId);
    });
    throw error;
  }
}

export async function deliveryMinecraftRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await jobs.recoverDeliveryMinecraft(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryMinecraftRecovery(input.intentId);
    });
    throw error;
  }
}

export async function deliveryForumBaselineWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await observation.observeDeliveryForumBaseline(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryForumBaseline(input.intentId);
    });
    throw error;
  }
}
