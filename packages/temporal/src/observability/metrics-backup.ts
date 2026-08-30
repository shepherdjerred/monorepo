import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "./metrics.ts";

export const seaweedFsBackupLastSuccessTimestampSeconds = new Gauge({
  name: "seaweedfs_backup_last_success_timestamp_seconds",
  help: "Unix timestamp of the last completed SeaweedFS bucket backup by cadence",
  labelNames: ["bucket", "cadence"] as const,
  registers: [register],
});

export const seaweedFsBackupDurationSeconds = new Histogram({
  name: "seaweedfs_backup_duration_seconds",
  help: "SeaweedFS bucket backup duration by cadence and outcome",
  labelNames: ["bucket", "cadence", "outcome"] as const,
  buckets: [60, 300, 900, 1800, 3600, 7200, 14_400, 28_800],
  registers: [register],
});

export const seaweedFsBackupStage = new Gauge({
  name: "seaweedfs_backup_stage",
  help: "Current SeaweedFS backup stage; the active stage is 1",
  labelNames: ["cadence", "stage"] as const,
  registers: [register],
});

export const seaweedFsBackupSourceBytes = new Gauge({
  name: "seaweedfs_backup_source_bytes",
  help: "Total bytes in each source bucket at the latest backup inventory",
  labelNames: ["bucket", "cadence"] as const,
  registers: [register],
});

export const seaweedFsBackupProtectedBytes = new Gauge({
  name: "seaweedfs_backup_protected_bytes",
  help: "Protected bytes represented by the latest completed manifest",
  labelNames: ["bucket", "cadence"] as const,
  registers: [register],
});

export const seaweedFsBackupObjects = new Gauge({
  name: "seaweedfs_backup_objects",
  help: "Objects copied or reused by the latest completed backup",
  labelNames: ["bucket", "cadence", "result"] as const,
  registers: [register],
});

export const seaweedFsBackupCopiedBytes = new Gauge({
  name: "seaweedfs_backup_copied_bytes",
  help: "Bytes transferred by the latest completed backup",
  labelNames: ["bucket", "cadence"] as const,
  registers: [register],
});

export const seaweedFsBackupVerificationTotal = new Counter({
  name: "seaweedfs_backup_verification_total",
  help: "SeaweedFS backup read-back and manifest verification outcomes",
  labelNames: ["bucket", "cadence", "outcome"] as const,
  registers: [register],
});

export const seaweedFsBackupCoverageBuckets = new Gauge({
  name: "seaweedfs_backup_coverage_buckets",
  help: "Count of SeaweedFS buckets with a coverage error by problem",
  labelNames: ["problem"] as const,
  registers: [register],
});

export const seaweedFsBackupRetainedPoints = new Gauge({
  name: "seaweedfs_backup_retained_points",
  help: "Completed SeaweedFS recovery points retained by tier",
  labelNames: ["tier"] as const,
  registers: [register],
});

export const seaweedFsBackupRetentionWarm = new Gauge({
  name: "seaweedfs_backup_retention_warm",
  help: "Whether enough calendar time has elapsed to expect a full retention tier",
  labelNames: ["tier"] as const,
  registers: [register],
});

export const seaweedFsBackupGcBacklog = new Gauge({
  name: "seaweedfs_backup_gc_backlog",
  help: "SeaweedFS backup GC candidate sets awaiting revalidation",
  registers: [register],
});

export const seaweedFsBackupGcObjects = new Gauge({
  name: "seaweedfs_backup_gc_objects",
  help: "Objects in the newest SeaweedFS backup GC candidate set",
  registers: [register],
});

export const seaweedFsBackupGcOldestCandidateTimestampSeconds = new Gauge({
  name: "seaweedfs_backup_gc_oldest_candidate_timestamp_seconds",
  help: "Creation timestamp of the oldest pending SeaweedFS backup GC candidate set",
  registers: [register],
});

export const seaweedFsBackupGcRevalidationFailuresTotal = new Counter({
  name: "seaweedfs_backup_gc_revalidation_failures_total",
  help: "SeaweedFS backup GC cycles stopped by failed protection-set revalidation",
  registers: [register],
});
