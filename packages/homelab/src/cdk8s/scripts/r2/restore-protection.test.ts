import { describe, expect, test } from "vitest";
import { restoreProtectedBackupNames } from "./restore-protection.ts";
import {
  buildR2OrphanManifest,
  R2OrphanManifestSchema,
} from "@shepherdjerred/homelab/cdk8s/scripts/r2-orphan-cleanup-core.ts";

const prefix = "zfspv-incr/backups/";
function key(
  name: string,
  volume = "pvc-a",
  schedule = "daily-backup",
): string {
  return `${prefix}${name}/torvalds/zfs/-${schedule}-${volume}-${name}.zfsvol`;
}

describe("OpenEBS restore history protection", () => {
  test("keeps preceding non-ancestors whose removal shifts full-base indexing", () => {
    const names = [
      "daily-backup-20260801000000",
      "daily-backup-20260802000000",
      "daily-backup-20260803000000",
    ];
    expect(
      restoreProtectedBackupNames({
        objectKeys: names.map((name) => key(name)),
        protectedBackupNames: [names[2] ?? ""],
        zfsPrefix: prefix,
      }),
    ).toEqual(names);
  });

  test("does not confuse different volumes or schedules with retained history", () => {
    expect(
      restoreProtectedBackupNames({
        objectKeys: [
          key("daily-backup-20260801000000", "pvc-b"),
          key("daily-backup-20260802000000"),
          key("weekly-backup-20260801000000", "pvc-a", "weekly-backup"),
        ],
        protectedBackupNames: ["daily-backup-20260802000000"],
        zfsPrefix: prefix,
      }),
    ).toEqual(["daily-backup-20260802000000"]);
  });

  test("checks data objects even when their volume metadata is absent", () => {
    expect(
      restoreProtectedBackupNames({
        objectKeys: [
          key("daily-backup-20260801000000").replace(/\.zfsvol$/, ""),
          key("daily-backup-20260802000000"),
        ],
        protectedBackupNames: ["daily-backup-20260802000000"],
        zfsPrefix: prefix,
      }),
    ).toEqual(["daily-backup-20260801000000", "daily-backup-20260802000000"]);
  });

  test("accepts chain markers alongside streams and preserves marker-only history", () => {
    const ancestor = "daily-backup-20260801000000";
    const latest = "daily-backup-20260802000000";
    const stream = key(latest).replace(/\.zfsvol$/, "");
    expect(
      restoreProtectedBackupNames({
        objectKeys: [
          `${key(ancestor).replace(/\.zfsvol$/, "")}.chain.json`,
          stream,
          `${stream}.zfsvol`,
          `${stream}.chain.json`,
        ],
        protectedBackupNames: [latest],
        zfsPrefix: prefix,
      }),
    ).toEqual([ancestor, latest]);
  });

  test("refuses unknown storage layouts", () => {
    expect(() =>
      restoreProtectedBackupNames({
        objectKeys: [`${prefix}unknown/chunk`],
        protectedBackupNames: [],
        zfsPrefix: prefix,
      }),
    ).toThrow("Unrecognized OpenEBS backup object");
  });

  test("protects ZFSBackup references even without a live Velero Backup", () => {
    const ancestor = "daily-backup-20260801000000";
    const latest = "daily-backup-20260802000000";
    const manifest = buildR2OrphanManifest({
      observedAt: "2026-08-11T20:00:00.000Z",
      storage: {
        bucket: "homelab",
        endpointHost: "example.r2.cloudflarestorage.com",
      },
      zfsObjects: [ancestor, latest].map((name) => ({
        key: key(name),
        size: 1,
        lastModified: "2026-08-09T00:00:00.000Z",
      })),
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
      zfsBackupNames: [latest],
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
    });
    expect(manifest.candidates).toEqual([]);
    expect(manifest.restoreProtectedBackupNames).toEqual([ancestor, latest]);
    expect(
      R2OrphanManifestSchema.safeParse({ ...manifest, contractVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      R2OrphanManifestSchema.safeParse({ ...manifest, contractVersion: 3 })
        .success,
    ).toBe(false);
  });
});
