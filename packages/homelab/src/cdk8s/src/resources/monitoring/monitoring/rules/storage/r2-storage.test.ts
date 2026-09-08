import { describe, expect, test } from "vitest";
import { getR2StorageRuleGroups } from "./r2-storage.ts";

function backupRules() {
  const group = getR2StorageRuleGroups().find(
    (candidate) => candidate.name === "seaweedfs-offsite-backup",
  );
  if (group?.rules === undefined) {
    throw new Error("Missing SeaweedFS off-site backup rule group");
  }
  return group.rules;
}

describe("SeaweedFS off-site backup alerts", () => {
  test("covers every planned failure mode and escalation", () => {
    const alerts = backupRules().map((rule) => [
      rule.alert,
      rule.labels?.["severity"],
      rule.for ?? "",
    ]);
    expect(alerts).toEqual([
      ["SeaweedFSBackupCriticalStale", "critical", "5m"],
      ["SeaweedFSBackupDailyLate", "warning", "5m"],
      ["SeaweedFSBackupDailyStale", "critical", "5m"],
      ["SeaweedFSBackupIntegrityFailure", "critical", ""],
      ["SeaweedFSBackupCoverageDrift", "warning", "15m"],
      ["SeaweedFSBackupCoverageDrift", "critical", "24h"],
      ["SeaweedFSBackupProtectedBucketMissing", "critical", "5m"],
      ["SeaweedFSBackupRetentionShortfall", "warning", "30m"],
      ["SeaweedFSBackupGcCandidateStuck", "warning", "30m"],
      ["SeaweedFSBackupGcRevalidationFailure", "warning", ""],
      ["SeaweedFSBackupBucketLockDrift", "critical", "15m"],
      ["SeaweedFSBackupCostProjectionHigh", "warning", "1h"],
    ]);
  });

  test("checks both locked prefixes and all GFS tiers", () => {
    const expressions = backupRules()
      .map((rule) => rule.expr.value)
      .join("\n");
    expect(expressions).toContain('prefix=~"objects/|snapshots/"');
    expect(expressions).toContain("2592000");
    expect(expressions).toContain('tier="sixHourly"');
    expect(expressions).toContain('tier="daily"');
    expect(expressions).toContain('tier="weekly"');
    expect(expressions).toContain('tier="monthly"');
    expect(expressions).toContain("0.015 > 10");
  });

  test("ignores uninitialized GC gauges outside the backup worker", () => {
    const alert = backupRules().find(
      (rule) => rule.alert === "SeaweedFSBackupGcCandidateStuck",
    );
    expect(alert?.expr.value).toContain(
      'namespace="temporal",container="temporal-backup-worker"',
    );
    expect(alert?.expr.value).toContain(
      "seaweedfs_backup_gc_oldest_candidate_timestamp_seconds",
    );
    expect(alert?.expr.value).toContain("> 0) and (time() -");
    expect(alert?.expr.value).toContain("> 14 * 24 * 60 * 60");
  });

  test("applies existing capacity and exporter alerts to every bucket label", () => {
    const storage = getR2StorageRuleGroups().find(
      (group) => group.name === "r2-storage",
    );
    if (storage?.rules === undefined) {
      throw new Error("Missing R2 storage rule group");
    }
    for (const rule of storage.rules) {
      expect(rule.expr.value).not.toContain('bucket="homelab"');
    }
  });
});
