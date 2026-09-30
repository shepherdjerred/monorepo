import { describe, expect, it } from "vitest";
import {
  computeR2Orphans,
  type R2ObjectSummary,
} from "./velero-r2-orphan-audit.ts";

const observedAt = Date.parse("2026-08-11T20:00:00.000Z");

function object(
  key: string,
  size: number,
  lastModified: string,
): R2ObjectSummary {
  return { key, size, lastModified: Date.parse(lastModified) };
}

describe("computeR2Orphans", () => {
  it("protects the union of live CRs and backup metadata", () => {
    const result = computeR2Orphans({
      observedAt,
      zfsObjects: [
        object(
          "zfspv-incr/backups/live-cr/chunk",
          10,
          "2026-08-09T00:00:00.000Z",
        ),
        object(
          "zfspv-incr/backups/metadata-only/chunk",
          20,
          "2026-08-09T00:00:00.000Z",
        ),
        object(
          "zfspv-incr/backups/orphan/chunk-a",
          30,
          "2026-08-09T00:00:00.000Z",
        ),
        object(
          "zfspv-incr/backups/orphan/chunk-b",
          12,
          "2026-08-08T00:00:00.000Z",
        ),
      ],
      liveBackupNames: ["live-cr"],
      metadataObjects: [
        object(
          "torvalds/backups/backups/metadata-only/velero-backup.json",
          5,
          "2026-08-09T00:00:00.000Z",
        ),
      ],
    });

    expect(result).toEqual({
      zfsPrefixCount: 3,
      orphanPrefixCount: 1,
      orphanBytes: 42,
    });
  });

  it("excludes prefixes newer than the 24 hour safety fence", () => {
    const result = computeR2Orphans({
      observedAt,
      zfsObjects: [
        object(
          "zfspv-incr/backups/recent/chunk",
          1,
          "2026-08-11T00:00:01.000Z",
        ),
      ],
      liveBackupNames: [],
      metadataObjects: [
        object(
          "torvalds/backups/backups/unrelated/velero-backup.json",
          5,
          "2026-08-09T00:00:00.000Z",
        ),
      ],
    });

    expect(result).toEqual({
      zfsPrefixCount: 1,
      orphanPrefixCount: 0,
      orphanBytes: 0,
    });
  });

  it("refuses to evaluate when metadata is empty but ZFS data exists", () => {
    expect(() =>
      computeR2Orphans({
        observedAt,
        zfsObjects: [
          object(
            "zfspv-incr/backups/orphan/chunk",
            1,
            "2026-08-09T00:00:00.000Z",
          ),
        ],
        liveBackupNames: [],
        metadataObjects: [],
      }),
    ).toThrow(/metadata under torvalds\/backups\/backups\/ is empty/);
  });

  it("ignores metadata objects outside the backups layout", () => {
    const result = computeR2Orphans({
      observedAt,
      zfsObjects: [
        object(
          "zfspv-incr/backups/orphan/chunk",
          7,
          "2026-08-09T00:00:00.000Z",
        ),
      ],
      liveBackupNames: [],
      // Objects directly under torvalds/backups/ (restores/, metadata/, …)
      // carry no backup name and must not join the protection set.
      metadataObjects: [
        object(
          "torvalds/backups/restores/some-restore",
          5,
          "2026-08-09T00:00:00.000Z",
        ),
        object(
          "torvalds/backups/backups/live-one/velero-backup.json",
          5,
          "2026-08-09T00:00:00.000Z",
        ),
      ],
    });

    expect(result).toEqual({
      zfsPrefixCount: 1,
      orphanPrefixCount: 1,
      orphanBytes: 7,
    });
  });
});
