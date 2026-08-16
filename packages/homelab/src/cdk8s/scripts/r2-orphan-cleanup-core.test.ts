import { describe, expect, test } from "bun:test";
import {
  assertManifestRevalidated,
  buildR2OrphanManifest,
  metadataBackupNames,
} from "./r2-orphan-cleanup-core.ts";

const observedAt = "2026-08-11T20:00:00.000Z";
const storage = {
  bucket: "homelab",
  endpointHost: "example.r2.cloudflarestorage.com",
};

describe("R2 orphan cleanup manifest", () => {
  test("protects the union of live CRs and backup metadata", () => {
    const objects = [
      {
        key: "zfspv-incr/backups/live-cr/chunk",
        size: 10,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
      {
        key: "zfspv-incr/backups/metadata-only/chunk",
        size: 20,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
      {
        key: "zfspv-incr/backups/orphan/chunk",
        size: 30,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
    ];
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: objects,
      liveBackupNames: ["live-cr"],
      metadataBackupNames: ["metadata-only"],
    });

    expect(manifest.protectedBackupNames).toEqual(["live-cr", "metadata-only"]);
    expect(
      manifest.candidates.map((candidate) => candidate.backupName),
    ).toEqual(["orphan"]);
    expect(manifest.candidates[0]?.prefix).toBe("zfspv-incr/backups/orphan/");
  });

  test("excludes prefixes newer than the 24 hour safety fence", () => {
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/recent/chunk",
          size: 1,
          lastModified: "2026-08-11T00:00:01.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
    });
    expect(manifest.candidates).toEqual([]);
  });

  // A scoped listing returns nothing when the prefix is wrong, so an empty
  // protection set is indistinguishable from a working, genuinely empty oracle.
  test("refuses to propose deletions when metadata is empty but ZFS data exists", () => {
    expect(() =>
      buildR2OrphanManifest({
        observedAt,
        storage,
        zfsObjects: [
          {
            key: "zfspv-incr/backups/orphan/chunk",
            size: 1,
            lastModified: "2026-08-09T00:00:00.000Z",
          },
        ],
        liveBackupNames: [],
        metadataBackupNames: [],
      }),
    ).toThrow("Refusing to propose R2 orphan deletions");
  });

  test("allows an empty observation when there is no ZFS data at all", () => {
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [],
      liveBackupNames: [],
      metadataBackupNames: [],
    });
    expect(manifest.candidates).toEqual([]);
  });

  // The deployed BackupStorageLocation prefix is "torvalds/backups/" and Velero
  // nests its own "backups/" directory beneath it, so real keys carry it twice.
  test("extracts backup names beneath Velero's nested backups directory", () => {
    expect(
      metadataBackupNames([
        {
          key: "torvalds/backups/backups/daily-1/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
        {
          key: "torvalds/backups/backups/daily-1/daily-1.tar.gz",
          size: 1,
          lastModified: observedAt,
        },
        {
          key: "torvalds/backups/backups/daily-2/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
      ]),
    ).toEqual(["daily-1", "daily-2"]);
  });

  test("never derives the constant directory name as a backup name", () => {
    expect(
      metadataBackupNames([
        {
          key: "torvalds/backups/backups/daily-1/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
      ]),
    ).not.toContain("backups");
  });

  test("reports no metadata when the location is genuinely empty", () => {
    expect(metadataBackupNames([])).toEqual([]);
  });

  test("refuses an empty protection set when the metadata layout drifts", () => {
    expect(() =>
      metadataBackupNames([
        {
          key: "torvalds/backups/daily-1/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
      ]),
    ).toThrow("refusing to treat an empty protection set as authoritative");
  });

  test("keeps a metadata-only backup out of the deletion manifest", () => {
    const metadata = metadataBackupNames([
      {
        key: "torvalds/backups/backups/pending-cr/velero-backup.json",
        size: 1,
        lastModified: observedAt,
      },
    ]);
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/pending-cr/chunk",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: metadata,
    });
    expect(manifest.protectedBackupNames).toEqual(["pending-cr"]);
    expect(manifest.candidates).toEqual([]);
  });

  test("rejects apply when object or protection state drifts", () => {
    const approved = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/orphan/chunk",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
    });
    const drifted = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/orphan/chunk",
          size: 2,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
    });
    expect(() => assertManifestRevalidated(approved, drifted)).toThrow(
      "no longer matches",
    );
  });
});

describe("R2 orphan cleanup safety options", () => {
  test("holds an existing prefix out of the deletion manifest", () => {
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/held/chunk",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
        {
          key: "zfspv-incr/backups/orphan/chunk",
          size: 2,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
      heldBackupNames: ["held"],
    });

    expect(manifest.heldBackupNames).toEqual(["held"]);
    expect(manifest.protectedBackupNames).toEqual(["held", "unrelated"]);
    expect(
      manifest.candidates.map((candidate) => candidate.backupName),
    ).toEqual(["orphan"]);
  });

  test("rejects a missing hold", () => {
    expect(() =>
      buildR2OrphanManifest({
        observedAt,
        storage,
        zfsObjects: [],
        liveBackupNames: [],
        metadataBackupNames: [],
        heldBackupNames: ["missing"],
      }),
    ).toThrow("Held R2 backup prefix is missing");
  });

  test("selects exactly one eligible backup prefix", () => {
    const manifest = buildR2OrphanManifest({
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/selected/chunk",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
        {
          key: "zfspv-incr/backups/other/chunk",
          size: 2,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
      onlyBackupName: "selected",
    });

    expect(manifest.onlyBackupName).toBe("selected");
    expect(
      manifest.candidates.map((candidate) => candidate.backupName),
    ).toEqual(["selected"]);
  });
});
