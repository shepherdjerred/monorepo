import { Context } from "@temporalio/activity";
import { replicateObject } from "@shepherdjerred/seaweedfs-backup/replicate";
import type { BackupByteProgress } from "@shepherdjerred/seaweedfs-backup/snapshot";
import { storesFromEnvironment } from "@shepherdjerred/seaweedfs-backup/store";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";

export type DeliveryReplica = {
  backupBucket: string;
  backupObjectKey: string;
  sha256: string;
};

export type DeliveryReplicationActivities =
  typeof deliveryReplicationActivities;

export const deliveryReplicationActivities = {
  /**
   * Copy one self-hosted Delivery artifact into the R2 backup layout (PC1).
   * The copy lands at the key the next snapshot would choose, so it is reused
   * rather than copied twice; the returned fields form the receipt the
   * Delivery API stores on the artifact.
   */
  async replicateDeliveryObject(input: {
    sourceBucket: string;
    sourceKey: string;
    /** Hex SHA-256 of the artifact digest; the copy must hash to it. */
    expectedSha256: string;
  }): Promise<DeliveryReplica> {
    return withBackupActivityHeartbeat<DeliveryReplica, BackupByteProgress>(
      Context.current(),
      async (hooks) => {
        const { source, destination, backupBucket } = storesFromEnvironment(
          Bun.env,
          { signal: hooks.signal },
        );
        const entry = await replicateObject({
          source,
          destination,
          backupBucket,
          sourceBucket: input.sourceBucket,
          sourceKey: input.sourceKey,
          expectedSha256: input.expectedSha256,
          onBytes(progress) {
            // Stream callbacks run outside the Activity promise; the store
            // enforces cancellation, so never throw from here.
            if (hooks.signal.aborted) return;
            hooks.onProgress(progress);
          },
        });
        return {
          backupBucket,
          backupObjectKey: entry.backupObjectKey,
          sha256: entry.sha256,
        };
      },
      { stage: "copy", bucket: input.sourceBucket, bytes: 0 },
    );
  },
};
