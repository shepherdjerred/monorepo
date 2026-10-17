import { expect, test } from "vitest";
import { TorrentObservationSchema } from "#integrations/qbittorrent.ts";
import protocol from "#integrations/fixtures/qbittorrent-5.2.4.json";
import { TorrentPolicySchema } from "#integrations/qbittorrent-policy.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { torrentIdentity } from "#migration/handoff-network/torrents.ts";
import { NativeRecoveryScopeSchema } from "#shared/native-recovery.ts";
import { observeNativeTorrents } from "./torrents.ts";

function fixture() {
  const upload = protocol.uploads.find((item) => item.kind === "hybrid");
  const observation = TorrentObservationSchema.parse({
    ...TorrentPolicySchema.parse(protocol.explicitMinutes),
    ...upload,
    name: "Synthetic torrent",
    state: "stoppedUP",
    category: "media",
    tags: "media-owned",
    progress: 1,
    ratio: 1,
    seeding_time: 100,
    size: 100,
    save_path: "/downloads/media/synthetic",
    content_path: "/downloads/media/synthetic/video.mkv",
  });
  const normalized = normalizeTorrentObservation(observation);
  if (normalized.kind !== "torrent") throw new Error("Invalid fixture kind");
  const torrent = NativeRecoveryScopeSchema.shape.torrents.element.parse({
    id: crypto.randomUUID(),
    infoHash: normalized.infoHash,
    qbittorrentId: observation.hash,
    state: "seeding",
    owned: true,
    ownershipEpoch: 3,
    seedingPolicy: { kind: "public" },
    observation: { identity: torrentIdentity(normalized) },
    attempts: [
      { id: crypto.randomUUID(), state: "completed", recoveryEpoch: 3 },
    ],
  });
  return { observation, torrent };
}
test("native torrent proof preserves hybrid full identities while seeding counters advance", async () => {
  const f = fixture();
  const run = () =>
    observeNativeTorrents({
      torrents: [f.torrent],
      qbittorrent: { listAll: () => Promise.resolve([f.observation]) },
      signal: AbortSignal.timeout(5000),
    });
  const before = await run();
  f.observation.ratio = { kind: "finite", value: 4 };
  f.observation.seeding_time = 10_000;
  expect(await run()).toEqual(before);
  expect(before[0]).toMatchObject({
    infoHash: f.observation.infohash_v1,
    wireId: f.observation.hash,
    sourceState: "present",
  });
});
test("proven terminal removal accepts fresh absence without granting source cleanup", async () => {
  const f = fixture();
  f.torrent.state = "removed";
  const result = await observeNativeTorrents({
    torrents: [f.torrent],
    qbittorrent: { listAll: () => Promise.resolve([]) },
    signal: AbortSignal.timeout(5000),
  });
  expect(result[0]).toMatchObject({ sourceState: "removed" });
});
test.each([
  "policy",
  "hash",
  "path",
  "removed-present",
  "removing",
  "unknown",
  "attempt",
  "epoch",
])("native source %s ambiguity protects", async (mode) => {
  const f = fixture();
  if (mode === "policy") f.observation.max_ratio = 999;
  if (mode === "hash") f.observation.infohash_v2 = "f".repeat(64);
  if (mode === "path") f.observation.save_path = "/downloads/replaced";
  if (mode === "removed-present") f.torrent.state = "removed";
  if (mode === "removing") f.torrent.state = "removing";
  if (mode === "unknown") f.torrent.state = "unknown";
  if (mode === "attempt")
    f.torrent.attempts = [
      { id: crypto.randomUUID(), state: "submitted", recoveryEpoch: 3 },
    ];
  if (mode === "epoch") f.torrent.ownershipEpoch = 4;
  await expect(
    observeNativeTorrents({
      torrents: [f.torrent],
      qbittorrent: { listAll: () => Promise.resolve([f.observation]) },
      signal: AbortSignal.timeout(5000),
    }),
  ).rejects.toThrow();
});
