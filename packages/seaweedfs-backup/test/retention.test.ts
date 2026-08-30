import { describe, expect, test } from "vitest";
import { SEAWEEDFS_BACKUP_POLICY } from "@shepherdjerred/seaweedfs-backup/policy";
import { selectRetainedSnapshotIds } from "@shepherdjerred/seaweedfs-backup/retention";
import { CompletionMarkerSchema } from "@shepherdjerred/seaweedfs-backup/schemas";

function marker(id: number, completedAt: string, cadence = "daily") {
  return CompletionMarkerSchema.parse({
    schemaVersion: 1,
    snapshotId: `20260101T000000.000Z-${id.toString(16).padStart(12, "0")}`,
    cadence,
    startedAt: completedAt,
    completedAt,
    manifests: [
      {
        bucket: "fixture",
        key: `snapshots/manifests/${String(id)}/fixture.ndjson.gz`,
        sha256: "a".repeat(64),
        objectCount: 0,
        sourceBytes: 0,
        protectedBytes: 0,
        copiedObjects: 0,
        reusedObjects: 0,
        copiedBytes: 0,
        durationSeconds: 0,
      },
    ],
  });
}

describe("Pacific GFS selection", () => {
  test("uses Pacific calendar days across spring DST", () => {
    const markers = [
      marker(1, "2026-03-08T07:30:00.000Z"),
      marker(2, "2026-03-08T08:30:00.000Z"),
      marker(3, "2026-03-09T06:30:00.000Z"),
      marker(4, "2026-03-09T07:30:00.000Z"),
    ];
    const retained = selectRetainedSnapshotIds(markers, {
      ...SEAWEEDFS_BACKUP_POLICY,
      retention: {
        ...SEAWEEDFS_BACKUP_POLICY.retention,
        daily: 2,
        weekly: 1,
        monthly: 1,
      },
    });
    expect(retained.has(markers[2]?.snapshotId ?? "")).toBe(true);
    expect(retained.has(markers[3]?.snapshotId ?? "")).toBe(true);
    expect(retained.has(markers[0]?.snapshotId ?? "")).toBe(false);
    expect(retained.has(markers[1]?.snapshotId ?? "")).toBe(false);
  });

  test("retains exactly the newest 28 six-hour points", () => {
    const markers = Array.from({ length: 40 }, (_, index) =>
      marker(
        index + 1,
        new Date(Date.UTC(2026, 0, 1, index * 6)).toISOString(),
        "six-hourly",
      ),
    );
    expect(
      selectRetainedSnapshotIds(markers, SEAWEEDFS_BACKUP_POLICY).size,
    ).toBe(28);
  });
});
