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
    if (ready.trmnlRepair) {
      const evidence = await mutation.applyDeliveryTrmnlPlugins(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
      });
      return;
    }
    if (ready.controlPlane) {
      const evidence = await controlPlane.executeDeliveryControlPlane(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
      });
      return;
    }
    if (ready.platform) {
      const evidence = await platform.executeDeliveryPlatform(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
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
  if (dispatched.status === "rejected") throw dispatched.reason;
  if (qualified.status === "rejected") throw qualified.reason;
  if (recovered.status === "rejected") throw recovered.reason;
  if (minecraftRecovered.status === "rejected") throw minecraftRecovered.reason;
  if (forumQualified.status === "rejected") throw forumQualified.reason;
  if (forumBaseline.status === "rejected") throw forumBaseline.reason;
  if (platformRecovered.status === "rejected") throw platformRecovered.reason;
  if (replicationFailures.length > 0) throw replicationFailures[0];
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
