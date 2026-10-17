import { expect, test } from "vitest";
import protocol from "#integrations/fixtures/qbittorrent-5.2.4.json";
import { TorrentPolicySchema } from "#integrations/qbittorrent-policy.ts";
import {
  normalizeTorrentObservation,
  captureTorrents,
} from "./torrent-capture.ts";
import { normalizeCapture } from "#migration/normalize.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";

test("real5.2.4 v1, v2 and hybrid wire identities survive capture independently and never grant ownership", async () => {
  const observations = protocol.uploads.map((upload) => ({
    ...TorrentPolicySchema.parse(protocol.explicitMinutes),
    hash: upload.hash,
    infohash_v1: upload.infohash_v1,
    infohash_v2: upload.infohash_v2,
    name: "Synthetic torrent",
    state: "stoppedUP",
    category: "radarr",
    tags: "legacy, films",
    progress: 1,
    ratio: { kind: "infinite" as const },
    seeding_time: 1234,
    size: 1,
    save_path: "/downloads/legacy",
    content_path: "/downloads/legacy/synthetic.mkv",
  }));
  for (const observation of observations) {
    const record = normalizeTorrentObservation(observation);
    expect(record).toMatchObject({
      wireId: observation.hash,
      infoHashV1: observation.infohash_v1 || null,
      infoHashV2: observation.infohash_v2 || null,
      infoHash: observation.infohash_v1 || observation.infohash_v2,
      seedingTimeLimitMinutes: 123,
      effectiveSeedingTimeLimitMinutes: 123,
      managerAssociations: [],
      ratio: { kind: "infinite" },
    });
    expect(
      MigrationRecordSchema.safeParse({ ...record, infoHash: "a".repeat(41) })
        .success,
    ).toBe(false);
  }
  const snapshot = await captureTorrents({
    sourceInstanceId: "c".repeat(64),
    version: "5.2.4",
    client: { listAll: async () => observations },
  });
  const report = normalizeCapture(snapshot, { targets: [] });
  expect(report.entries).toHaveLength(3);
  for (const entry of report.entries)
    expect(entry).toMatchObject({
      owned: false,
      state: "protected",
      reasons: ["manager_association_missing", "ownership_handoff_missing"],
    });
});
