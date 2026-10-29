// Frozen dispatch tick recorded while off-cluster replication existed and an
// artifact awaited its replica: the replication marker, the pending list,
// one copy on the backup queue and its receipt, then the dispatch tick. Keep
// these commands independent of the production Workflow and queue constants
// so replay catches drift.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

type ReplicationActivities = {
  listDeliveryReplications: () => Promise<{
    artifacts: { artifactId: string; uri: string; digest: string }[];
  }>;
  recordDeliveryReplication: (input: unknown) => Promise<void>;
};
type BackupActivities = {
  replicateDeliveryObject: (input: {
    sourceBucket: string;
    sourceKey: string;
    expectedSha256: string;
  }) => Promise<{
    backupBucket: string;
    backupObjectKey: string;
    sha256: string;
  }>;
};

const delivery = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const replication = proxyActivities<ReplicationActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const backup = proxyActivities<BackupActivities>({
  taskQueue: "backup",
  startToCloseTimeout: "3 minutes",
  retry: { maximumAttempts: 1 },
});

const TICK = [
  "qualifyDeliveryBuilds",
  "dispatchPendingDeliveries",
  "dispatchDeliveryWorkerRecoveries",
  "dispatchDeliveryMinecraftRecoveries",
  "qualifyDeliveryForumBundles",
  "dispatchDeliveryForumBaselines",
  "dispatchDeliveryPlatformRecoveries",
] as const;

export async function deliveryDispatchWorkflow() {
  if (patched("delivery-dispatch-replication-v1")) {
    const pending = await replication.listDeliveryReplications();
    for (const artifact of pending.artifacts) {
      const [, bucket = "", key = ""] =
        /^s3:\/\/([^/]+)\/(.+)$/u.exec(artifact.uri) ?? [];
      const replica = await backup.replicateDeliveryObject({
        sourceBucket: bucket,
        sourceKey: key,
        expectedSha256: artifact.digest.slice("sha256:".length),
      });
      await replication.recordDeliveryReplication({
        artifactId: artifact.artifactId,
        replica,
      });
    }
  }
  await Promise.allSettled(TICK.map(async (name) => await delivery[name]()));
  if (patched("delivery-dispatch-model-v1"))
    await Promise.allSettled([
      delivery.observeDeliveryMonitors(),
      delivery.observeDeliveryDrift(),
      delivery.removeDeliveryTargets(),
    ]);
}
