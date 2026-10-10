import { describe, expect, test } from "vitest";
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
        key: "zfspv-incr/backups/live-cr/torvalds/zfs/-fixture-pvc-live-cr-live-cr",
        size: 10,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
      {
        key: "zfspv-incr/backups/metadata-only/torvalds/zfs/-fixture-pvc-metadata-only-metadata-only",
        size: 20,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
      {
        key: "zfspv-incr/backups/orphan/torvalds/zfs/-fixture-pvc-orphan-orphan",
        size: 30,
        lastModified: "2026-08-09T00:00:00.000Z",
      },
    ];
    const manifest = buildR2OrphanManifest({
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
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
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/recent/torvalds/zfs/-fixture-pvc-recent-recent",
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
        chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
        observedAt,
        storage,
        zfsBackupNames: [],
        zfsObjects: [
          {
            key: "zfspv-incr/backups/orphan/torvalds/zfs/-fixture-pvc-orphan-orphan",
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
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
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
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/pending-cr/torvalds/zfs/-fixture-pvc-pending-cr-pending-cr",
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
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/orphan/torvalds/zfs/-fixture-pvc-orphan-orphan",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["unrelated"],
    });
    const drifted = buildR2OrphanManifest({
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/orphan/torvalds/zfs/-fixture-pvc-orphan-orphan",
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
  test("protects expired ancestors and refuses incomplete retained chains", () => {
    const input = {
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/expired-full/stream",
          size: 10,
          lastModified: "2026-08-09T00:00:00.000Z",
          etag: '"original"',
        },
      ],
      liveBackupNames: ["retained"],
      metadataBackupNames: ["retained"],
      chainProtection: {
        protectedBackupNames: ["expired-full"],
        incompleteRoots: [],
      },
    };
    expect(buildR2OrphanManifest(input).candidates).toEqual([]);
    const incomplete = buildR2OrphanManifest({
      ...input,
      chainProtection: {
        protectedBackupNames: [],
        incompleteRoots: ["retained"],
      },
    });
    expect(() => assertManifestRevalidated(incomplete, incomplete)).toThrow(
      "chains are incomplete",
    );
  });

  test("rejects same-size object replacement using the reviewed ETag", () => {
    const input = {
      observedAt,
      storage,
      zfsObjects: [
        {
          key: "zfspv-incr/backups/orphan/stream",
          size: 10,
          lastModified: "2026-08-09T00:00:00.000Z",
          etag: '"original"',
        },
      ],
      liveBackupNames: [],
      metadataBackupNames: ["retained"],
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
    };
    const approved = buildR2OrphanManifest(input);
    const replaced = buildR2OrphanManifest({
      ...input,
      zfsObjects: input.zfsObjects.map((object) => ({
        ...object,
        etag: '"replacement"',
      })),
    });
    expect(() => assertManifestRevalidated(approved, replaced)).toThrow(
      "no longer matches",
    );
  });

  test("holds an existing prefix out of the deletion manifest", () => {
    const manifest = buildR2OrphanManifest({
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/held/torvalds/zfs/-fixture-pvc-held-held",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
        {
          key: "zfspv-incr/backups/orphan/torvalds/zfs/-fixture-pvc-orphan-orphan",
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
        chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
        observedAt,
        storage,
        zfsBackupNames: [],
        zfsObjects: [],
        liveBackupNames: [],
        metadataBackupNames: [],
        heldBackupNames: ["missing"],
      }),
    ).toThrow("Held R2 backup prefix is missing");
  });

  test("selects exactly one eligible backup prefix", () => {
    const manifest = buildR2OrphanManifest({
      chainProtection: { protectedBackupNames: [], incompleteRoots: [] },
      observedAt,
      storage,
      zfsBackupNames: [],
      zfsObjects: [
        {
          key: "zfspv-incr/backups/selected/torvalds/zfs/-fixture-pvc-selected-selected",
          size: 1,
          lastModified: "2026-08-09T00:00:00.000Z",
        },
        {
          key: "zfspv-incr/backups/other/torvalds/zfs/-fixture-pvc-other-other",
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
