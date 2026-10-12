import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CompletionMarkerSchema } from "@shepherdjerred/seaweedfs-backup/schemas";
import {
  seaweedFsBackupGcBacklog,
  seaweedFsBackupGcObjects,
  seaweedFsBackupGcOldestCandidateTimestampSeconds,
  seaweedFsBackupRetainedPoints,
  seaweedFsBackupRetentionWarm,
} from "#observability/metrics-backup.ts";
import { restoreSeaweedFsBackupMetrics } from "./seaweedfs-backup.ts";

const inventory = vi.hoisted(() => ({
  listBuckets: vi.fn(),
  listCompletionMarkers: vi.fn(),
  readGcInventory: vi.fn(),
}));

vi.mock("@shepherdjerred/seaweedfs-backup/gc", () => ({
  readGcInventory: inventory.readGcInventory,
}));

vi.mock("@shepherdjerred/seaweedfs-backup/store", () => ({
  storesFromEnvironment: () => ({
    source: { listBuckets: inventory.listBuckets },
    destination: {},
    backupBucket: "fixture",
  }),
}));
vi.mock("@shepherdjerred/seaweedfs-backup/manifest", () => ({
  listCompletionMarkers: inventory.listCompletionMarkers,
}));

function marker(id: number, completedAt: string, cadence = "daily") {
  return CompletionMarkerSchema.parse({
    schemaVersion: 1,
    snapshotId: `20260101T000000.000Z-${id.toString(16).padStart(12, "0")}`,
    cadence,
    startedAt: completedAt,
    completedAt,
    manifests: [
      {
        bucket: "relay-docs",
        key: `snapshots/manifests/${String(id)}/relay-docs.ndjson.gz`,
        sha256: "a".repeat(64),
        objectCount: 1,
        sourceBytes: 4,
        protectedBytes: 4,
        copiedObjects: 1,
        reusedObjects: 0,
        copiedBytes: 4,
        durationSeconds: 1,
      },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T20:00:00Z"));
  inventory.listBuckets.mockReset().mockResolvedValue([]);
  inventory.listCompletionMarkers.mockReset();
  inventory.readGcInventory.mockReset().mockResolvedValue({
    candidateBacklog: 0,
    candidateCount: 0,
    oldestPendingTimestampSeconds: 0,
  });
  seaweedFsBackupRetainedPoints.reset();
  seaweedFsBackupRetentionWarm.reset();
  seaweedFsBackupGcBacklog.reset();
  seaweedFsBackupGcObjects.reset();
  seaweedFsBackupGcOldestCandidateTimestampSeconds.reset();
  seaweedFsBackupGcBacklog.remove();
  seaweedFsBackupGcObjects.remove();
  seaweedFsBackupGcOldestCandidateTimestampSeconds.remove();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SeaweedFS recovery-point metrics after worker restart", () => {
  test("rebuilds observed tiers and cadence-specific warmup without running maintenance", async () => {
    inventory.listCompletionMarkers.mockResolvedValue([
      marker(1, "2026-10-03T19:00:00Z", "six-hourly"),
      marker(2, "2026-09-25T19:00:00Z", "six-hourly"),
      marker(3, "2026-10-03T18:30:00Z"),
      marker(4, "2026-08-01T18:30:00Z"),
    ]);
    await restoreSeaweedFsBackupMetrics();
    const points = await seaweedFsBackupRetainedPoints.get();
    const warm = await seaweedFsBackupRetentionWarm.get();
    expect(points.values.map((v) => [v.labels.tier, v.value])).toEqual([
      ["sixHourly", 2],
      ["daily", 2],
      ["weekly", 2],
      ["monthly", 2],
    ]);
    expect(warm.values.map((v) => [v.labels.tier, v.value])).toEqual([
      ["sixHourly", 1],
      ["daily", 1],
      ["weekly", 1],
      ["monthly", 0],
    ]);
  });

  test("reports an empty inventory as zero instead of pretending configured targets are retained", async () => {
    inventory.listCompletionMarkers.mockResolvedValue([]);
    await restoreSeaweedFsBackupMetrics();
    const points = await seaweedFsBackupRetainedPoints.get();
    const warm = await seaweedFsBackupRetentionWarm.get();
    expect(points.values).toHaveLength(4);
    expect(points.values.every((v) => v.value === 0)).toBe(true);
    expect(warm.values.every((v) => v.value === 0)).toBe(true);
  });

  test("does not publish a healthy inventory when the marker read fails", async () => {
    const error = new Error("Marker inventory unavailable");
    inventory.listCompletionMarkers.mockRejectedValue(error);
    await expect(restoreSeaweedFsBackupMetrics()).rejects.toBe(error);
    const points = await seaweedFsBackupRetainedPoints.get();
    const warm = await seaweedFsBackupRetentionWarm.get();
    expect(points.values).toEqual([]);
    expect(warm.values).toEqual([]);
  });

  test("restores persisted GC backlog instead of the gauge's default zero", async () => {
    inventory.listCompletionMarkers.mockResolvedValue([]);
    inventory.readGcInventory.mockResolvedValue({
      candidateBacklog: 3,
      candidateCount: 17,
      oldestPendingTimestampSeconds: 1_790_000_000,
    });
    await restoreSeaweedFsBackupMetrics();
    const backlog = await seaweedFsBackupGcBacklog.get();
    const count = await seaweedFsBackupGcObjects.get();
    const oldest = await seaweedFsBackupGcOldestCandidateTimestampSeconds.get();
    expect(backlog.values[0]?.value).toBe(3);
    expect(count.values[0]?.value).toBe(17);
    expect(oldest.values[0]?.value).toBe(1_790_000_000);
  });

  test("does not report an empty backlog if candidate inventory is unreadable", async () => {
    inventory.listCompletionMarkers.mockResolvedValue([]);
    inventory.readGcInventory.mockRejectedValue(new Error("Invalid GC set"));
    await expect(restoreSeaweedFsBackupMetrics()).rejects.toThrow(
      "Invalid GC set",
    );
    const points = await seaweedFsBackupRetainedPoints.get();
    const backlog = await seaweedFsBackupGcBacklog.get();
    const oldest = await seaweedFsBackupGcOldestCandidateTimestampSeconds.get();
    expect(points.values).toEqual([]);
    expect(backlog.values).toEqual([]);
    expect(oldest.values).toEqual([]);
  });
});
