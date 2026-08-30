import { Context } from "@temporalio/activity";
import { runGcCycle } from "@shepherdjerred/seaweedfs-backup/gc";
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
} from "@shepherdjerred/seaweedfs-backup/schemas";
import { runBackup } from "@shepherdjerred/seaweedfs-backup/snapshot";
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
  seaweedFsBackupProtectedBytes,
  seaweedFsBackupRetainedPoints,
  seaweedFsBackupRetentionWarm,
  seaweedFsBackupSourceBytes,
  seaweedFsBackupStage,
  seaweedFsBackupVerificationTotal,
} from "#observability/metrics-backup.ts";

const log = createStructuredLogger("seaweedfs-backup");
const STAGES = ["inventory", "bucket", "copy", "verify", "complete"] as const;

export type SeaweedFsBackupActivities = typeof seaweedFsBackupActivities;

function setStage(
  cadence: BackupCadence,
  active: (typeof STAGES)[number],
): void {
  for (const stage of STAGES) {
    seaweedFsBackupStage.set({ cadence, stage }, stage === active ? 1 : 0);
  }
}

export async function restoreSeaweedFsBackupMetrics(): Promise<void> {
  const { source, destination, backupBucket } = storesFromEnvironment();
  const [sourceBuckets, markers] = await Promise.all([
    source.listBuckets(),
    listCompletionMarkers(destination, backupBucket),
  ]);
  const coverage = evaluateCoverage(sourceBuckets, SEAWEEDFS_BACKUP_POLICY);
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
    const cadence = BackupCadenceSchema.parse(input.cadence);
    const runStartedAt = performance.now();
    let activeBucket = "run";
    const { source, destination, backupBucket } = storesFromEnvironment();
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
          Context.current().heartbeat({
            stage: progress.stage,
            ...(progress.stage === "complete"
              ? { snapshotId: progress.snapshotId }
              : {}),
            ...(progress.stage === "copy" || progress.stage === "verify"
              ? { completed: progress.completed, total: progress.total }
              : {}),
          });
        },
        onBytes(progress) {
          const now = Date.now();
          if (now - lastByteHeartbeatAt < 30_000) return;
          lastByteHeartbeatAt = now;
          activeBucket = progress.bucket;
          setStage(cadence, progress.stage);
          Context.current().heartbeat({
            stage: progress.stage,
            bucket: progress.bucket,
            bytes: progress.bytes,
          });
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

  async runSeaweedFsBackupRetentionAndGc(): Promise<{
    deletedSnapshots: number;
    deletedObjects: number;
    candidateObjects: number;
  }> {
    const { destination, backupBucket } = storesFromEnvironment();
    try {
      const pruned = await pruneExpiredSnapshots({
        store: destination,
        backupBucket,
        policy: SEAWEEDFS_BACKUP_POLICY,
      });
      const counts = retainedPointCounts(
        pruned.markers,
        SEAWEEDFS_BACKUP_POLICY,
      );
      for (const [tier, count] of Object.entries(counts)) {
        seaweedFsBackupRetainedPoints.set({ tier }, count);
      }
      const oldestSixHourly = pruned.markers
        .filter((marker) => marker.cadence === "six-hourly")
        .map((marker) => Date.parse(marker.completedAt))
        .reduce<number | undefined>(
          (oldest, value) =>
            oldest === undefined || value < oldest ? value : oldest,
          undefined,
        );
      const oldestDaily = pruned.markers
        .filter((marker) => marker.cadence === "daily")
        .map((marker) => Date.parse(marker.completedAt))
        .reduce<number | undefined>(
          (oldest, value) =>
            oldest === undefined || value < oldest ? value : oldest,
          undefined,
        );
      const ageDays = (value: number | undefined): number =>
        value === undefined ? 0 : (Date.now() - value) / 86_400_000;
      const warmAfterDays = {
        sixHourly: 7,
        daily: 30,
        weekly: 56,
        monthly: 366,
      } as const;
      for (const [tier, days] of Object.entries(warmAfterDays)) {
        const oldest = tier === "sixHourly" ? oldestSixHourly : oldestDaily;
        seaweedFsBackupRetentionWarm.set(
          { tier },
          ageDays(oldest) >= days ? 1 : 0,
        );
      }
      Context.current().heartbeat({ stage: "gc-revalidate" });
      const gc = await runGcCycle({
        store: destination,
        backupBucket,
        policy: SEAWEEDFS_BACKUP_POLICY,
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
      seaweedFsBackupGcRevalidationFailuresTotal.inc();
      throw error;
    }
  },
};
