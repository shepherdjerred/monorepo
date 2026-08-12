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
      metadataBackupNames: [],
    });
    expect(manifest.candidates).toEqual([]);
  });

  test("extracts backup names from R2 metadata", () => {
    expect(
      metadataBackupNames([
        {
          key: "torvalds/backups/daily-1/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
        {
          key: "torvalds/backups/daily-2/velero-backup.json",
          size: 1,
          lastModified: observedAt,
        },
      ]),
    ).toEqual(["daily-1", "daily-2"]);
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
      metadataBackupNames: [],
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
      metadataBackupNames: [],
    });
    expect(() => assertManifestRevalidated(approved, drifted)).toThrow(
      "no longer matches",
    );
  });
});
