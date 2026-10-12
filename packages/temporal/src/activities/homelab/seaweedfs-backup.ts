import { Context } from "@temporalio/activity";
import {
  withBackupActivityHeartbeat,
  withBackupMaintenanceHeartbeat,
} from "./seaweedfs-backup-heartbeat.ts";
import {
  readGcInventory,
  runGcCycle,
} from "@shepherdjerred/seaweedfs-backup/gc";
import { listCompletionMarkers } from "@shepherdjerred/seaweedfs-backup/manifest";
import {
  SEAWEEDFS_BACKUP_POLICY,
  evaluateCoverage,
} from "@shepherdjerred/seaweedfs-backup/policy";
import {
  retainedPointCounts,
  pruneExpiredSnapshots,
} from "@shepherdjerred/seaweedfs-backup/retention";
import {
  BackupCadenceSchema,
  type BackupCadence,
  type CompletionMarker,
} from "@shepherdjerred/seaweedfs-backup/schemas";
import {
  runBackup,
  type BackupByteProgress,
  type BackupProgress,
} from "@shepherdjerred/seaweedfs-backup/snapshot";
import { storesFromEnvironment } from "@shepherdjerred/seaweedfs-backup/store";
import { createStructuredLogger } from "#observability/logging.ts";
import {
  seaweedFsBackupCopiedBytes,
  seaweedFsBackupCoverageBuckets,
  seaweedFsBackupDurationSeconds,
  seaweedFsBackupGcBacklog,
  seaweedFsBackupGcObjects,
  seaweedFsBackupGcOldestCandidateTimestampSeconds,
  seaweedFsBackupGcRevalidationFailuresTotal,
  seaweedFsBackupLastSuccessTimestampSeconds,
  seaweedFsBackupObjects,
  seaweedFsBackupObservationTimestampSeconds,
  seaweedFsBackupProtectedBytes,
  seaweedFsBackupRetainedPoints,
  seaweedFsBackupRetentionWarm,
  seaweedFsBackupSourceBytes,
  seaweedFsBackupStage,
  seaweedFsBackupStageObservationTimestampSeconds,
  seaweedFsBackupVerificationTotal,
} from "#observability/metrics-backup.ts";

const log = createStructuredLogger("seaweedfs-backup");
const STAGES = ["inventory", "bucket", "copy", "verify", "complete"] as const;

function restoreRetentionMetrics(markers: readonly CompletionMarker[]): void {
  const counts = retainedPointCounts(markers, SEAWEEDFS_BACKUP_POLICY);
  for (const [tier, count] of Object.entries(counts)) {
    seaweedFsBackupRetainedPoints.set({ tier }, count);
  }
  const oldestByCadence = new Map<BackupCadence, number>();
  for (const marker of markers) {
    const completedAt = Date.parse(marker.completedAt);
    const oldest = oldestByCadence.get(marker.cadence);
    if (oldest === undefined || completedAt < oldest) {
      oldestByCadence.set(marker.cadence, completedAt);
    }
  }
  const warmAfterDays = {
    sixHourly: 7,
    daily: 30,
    weekly: 56,
    monthly: 366,
  } as const;
  for (const [tier, days] of Object.entries(warmAfterDays)) {
    const oldest = oldestByCadence.get(
      tier === "sixHourly" ? "six-hourly" : "daily",
    );
    seaweedFsBackupRetentionWarm.set(
      { tier },
      oldest !== undefined && (Date.now() - oldest) / 86_400_000 >= days
        ? 1
        : 0,
    );
  }
}

export type SeaweedFsBackupActivities = typeof seaweedFsBackupActivities;

function setStage(
  cadence: BackupCadence,
  active: (typeof STAGES)[number],
): void {
  for (const stage of STAGES) {
    seaweedFsBackupStage.set({ cadence, stage }, stage === active ? 1 : 0);
  }
  seaweedFsBackupStageObservationTimestampSeconds.set(
    { cadence },
    Date.now() / 1000,
  );
}

export async function restoreSeaweedFsBackupMetrics(): Promise<void> {
  const { source, destination, backupBucket } = storesFromEnvironment();
  const [sourceBuckets, markers, gc] = await Promise.all([
    source.listBuckets(),
    listCompletionMarkers(destination, backupBucket),
    readGcInventory({ store: destination, backupBucket }),
  ]);
  const coverage = evaluateCoverage(sourceBuckets, SEAWEEDFS_BACKUP_POLICY);
  // These gauges otherwise disappear on every rollout until weekly GC runs.
  // Published markers supply the inventory without invoking pruning or GC.
  restoreRetentionMetrics(markers);
  seaweedFsBackupGcBacklog.set(gc.candidateBacklog);
  seaweedFsBackupGcObjects.set(gc.candidateCount);
  seaweedFsBackupGcOldestCandidateTimestampSeconds.set(
    gc.oldestPendingTimestampSeconds,
  );
  seaweedFsBackupCoverageBuckets.set(
    { problem: "unclassified" },
    coverage.unclassified.length,
  );
  seaweedFsBackupCoverageBuckets.set(
    { problem: "protected-missing" },
    coverage.missingProtected.length,
  );
  for (const cadence of BackupCadenceSchema.options) {
    const latest = markers.filter((marker) => marker.cadence === cadence);
    const restoredBuckets = new Set<string>();
    for (const marker of latest) {
      for (const manifest of marker.manifests) {
        if (restoredBuckets.has(manifest.bucket)) continue;
        restoredBuckets.add(manifest.bucket);
        seaweedFsBackupLastSuccessTimestampSeconds.set(
          { bucket: manifest.bucket, cadence },
          Date.parse(marker.completedAt) / 1000,
        );
      }
    }
  }
}

export const seaweedFsBackupActivities = {
  async runSeaweedFsBackup(input: {
    cadence: BackupCadence;
  }): Promise<{ snapshotId: string; buckets: number }> {
    return withBackupActivityHeartbeat<
      { snapshotId: string; buckets: number },
      BackupProgress | BackupByteProgress
    >(
      Context.current(),
      async (hooks) => {
        const cadence = BackupCadenceSchema.parse(input.cadence);
        const runStartedAt = performance.now();
        setStage(cadence, "inventory");
        let activeBucket = "run";
        const { source, destination, backupBucket } = storesFromEnvironment(
          Bun.env,
          {
            signal: hooks.signal,
          },
        );
        const coverage = evaluateCoverage(
          await source.listBuckets(),
          SEAWEEDFS_BACKUP_POLICY,
        );
        seaweedFsBackupCoverageBuckets.set(
          { problem: "unclassified" },
          coverage.unclassified.length,
        );
        seaweedFsBackupCoverageBuckets.set(
          { problem: "protected-missing" },
          coverage.missingProtected.length,
        );
        let lastByteHeartbeatAt = 0;
        try {
          const result = await runBackup({
            source,
            destination,
            backupBucket,
            policy: SEAWEEDFS_BACKUP_POLICY,
            cadence,
            onProgress(progress) {
              if ("bucket" in progress) activeBucket = progress.bucket;
              setStage(cadence, progress.stage);
              hooks.onProgress(progress);
            },
            onBytes(progress) {
              // Retry timers also invoke this callback outside a promise.
              // Cancellation is enforced by the store and Activity owner.
              if (hooks.signal.aborted) return;
              const now = Date.now();
              if (now - lastByteHeartbeatAt < 30_000) return;
              lastByteHeartbeatAt = now;
              activeBucket = progress.bucket;
              setStage(cadence, progress.stage);
              hooks.onProgress(progress);
            },
          });
          for (const bucket of result.buckets) {
            seaweedFsBackupSourceBytes.set(
              { bucket: bucket.bucket, cadence },
              bucket.sourceBytes,
            );
            seaweedFsBackupProtectedBytes.set(
              { bucket: bucket.bucket, cadence },
              bucket.protectedBytes,
            );
            seaweedFsBackupObjects.set(
              { bucket: bucket.bucket, cadence, result: "copied" },
              bucket.copiedObjects,
            );
            seaweedFsBackupObjects.set(
              { bucket: bucket.bucket, cadence, result: "reused" },
              bucket.reusedObjects,
            );
            seaweedFsBackupCopiedBytes.set(
              { bucket: bucket.bucket, cadence },
              bucket.copiedBytes,
            );
            seaweedFsBackupObservationTimestampSeconds.set(
              { bucket: bucket.bucket, cadence },
              Date.parse(result.marker.completedAt) / 1000,
            );
            seaweedFsBackupDurationSeconds.observe(
              { bucket: bucket.bucket, cadence, outcome: "success" },
              bucket.durationSeconds,
            );
            seaweedFsBackupLastSuccessTimestampSeconds.set(
              { bucket: bucket.bucket, cadence },
              Date.parse(result.marker.completedAt) / 1000,
            );
            seaweedFsBackupVerificationTotal.inc({
              bucket: bucket.bucket,
              cadence,
              outcome: "success",
            });
          }
          log("info", "SeaweedFS backup completed", {
            snapshotId: result.marker.snapshotId,
            cadence,
            bucketCount: result.buckets.length,
            objectCount: result.buckets.reduce(
              (total, bucket) => total + bucket.objectCount,
              0,
            ),
            copiedBytes: result.buckets.reduce(
              (total, bucket) => total + bucket.copiedBytes,
              0,
            ),
          });
          return {
            snapshotId: result.marker.snapshotId,
            buckets: result.buckets.length,
          };
        } catch (error: unknown) {
          seaweedFsBackupVerificationTotal.inc({
            bucket: activeBucket,
            cadence,
            outcome: "failure",
          });
          seaweedFsBackupDurationSeconds.observe(
            { bucket: activeBucket, cadence, outcome: "failure" },
            (performance.now() - runStartedAt) / 1000,
          );
          throw error;
        }
      },
      { stage: "inventory" },
      true,
    );
  },

  async runSeaweedFsBackupRetentionAndGc(): Promise<{
    deletedSnapshots: number;
    deletedObjects: number;
    candidateObjects: number;
  }> {
    return withBackupMaintenanceHeartbeat(Context.current(), async (hooks) => {
      const { destination, backupBucket } = storesFromEnvironment(Bun.env, {
        signal: hooks.signal,
      });
      try {
        const pruned = await pruneExpiredSnapshots({
          store: destination,
          backupBucket,
          policy: SEAWEEDFS_BACKUP_POLICY,
          hooks,
        });
        restoreRetentionMetrics(pruned.markers);
        const gc = await runGcCycle({
          store: destination,
          backupBucket,
          policy: SEAWEEDFS_BACKUP_POLICY,
          hooks,
        });
        seaweedFsBackupGcBacklog.set(gc.candidateBacklog);
        seaweedFsBackupGcObjects.set(gc.candidateCount);
        seaweedFsBackupGcOldestCandidateTimestampSeconds.set(
          gc.oldestPendingTimestampSeconds,
        );
        log("info", "SeaweedFS backup retention and GC completed", {
          deletedSnapshots: pruned.deletedSnapshots,
          deletedObjects: gc.deleted,
          retainedCandidates: gc.retained,
          candidateObjects: gc.candidateCount,
          candidateBacklog: gc.candidateBacklog,
        });
        return {
          deletedSnapshots: pruned.deletedSnapshots,
          deletedObjects: gc.deleted,
          candidateObjects: gc.candidateCount,
        };
      } catch (error: unknown) {
        if (!hooks.signal.aborted) {
          seaweedFsBackupGcRevalidationFailuresTotal.inc();
        }
        throw error;
      }
    });
  },
};
