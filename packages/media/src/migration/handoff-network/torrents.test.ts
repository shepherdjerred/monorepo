import { expect, test } from "vitest";
import protocol from "#integrations/fixtures/qbittorrent-5.2.4.json";
import { TorrentPolicySchema } from "#integrations/qbittorrent-policy.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { torrentIdentity } from "./torrents.ts";

test("v1, v2 and hybrid stable handoff identity excludes evolving seed counters but binds complete hashes and effective policy", () => {
  for (const upload of protocol.uploads) {
    const observation = {
      ...TorrentPolicySchema.parse(protocol.explicitMinutes),
      hash: upload.hash,
      infohash_v1: upload.infohash_v1,
      infohash_v2: upload.infohash_v2,
      name: "Synthetic",
      state: "uploading",
      category: "radarr",
      tags: "film",
      progress: 1,
      ratio: { kind: "finite" as const, value: 1 },
      seeding_time: 10,
      size: 1,
      save_path: "/downloads",
      content_path: "/downloads/file",
    };
    const record = normalizeTorrentObservation(observation);
    const later = normalizeTorrentObservation({
      ...observation,
      seeding_time: 100,
      ratio: { kind: "finite", value: 2 },
    });
    if (record.kind !== "torrent" || later.kind !== "torrent")
      throw new Error("Expected torrent normalization");
    expect(snapshotHash(record)).not.toBe(snapshotHash(later));
    expect(snapshotHash(torrentIdentity(record))).toBe(
      snapshotHash(torrentIdentity(later)),
    );
    for (const changed of [
      { ...later, effectiveSeedingTimeLimitMinutes: 999 },
      { ...later, wireId: "b".repeat(40) },
      { ...later, infoHashV2: "c".repeat(64) },
      { ...later, savePath: "/different" },
    ])
      expect(snapshotHash(torrentIdentity(changed))).not.toBe(
        snapshotHash(torrentIdentity(record)),
      );
  }
});
