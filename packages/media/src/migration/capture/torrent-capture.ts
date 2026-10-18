import type {
  QbittorrentClient,
  TorrentObservation,
} from "#integrations/qbittorrent.ts";
import {
  MigrationRecordSchema,
  MigrationSnapshotSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import { recordDigest, validateCapture } from "./capture-validation.ts";

export function normalizeTorrentObservation(
  torrent: TorrentObservation,
): MigrationRecord {
  const infoHashV1 = torrent.infohash_v1 === "" ? null : torrent.infohash_v1;
  const infoHashV2 = torrent.infohash_v2 === "" ? null : torrent.infohash_v2;
  if (infoHashV1 === null && infoHashV2 === null)
    throw new Error("Torrent cryptographic identity missing");
  return MigrationRecordSchema.parse({
    kind: "torrent",
    sourceId: torrent.hash,
    infoHash: infoHashV1 ?? infoHashV2,
    wireId: torrent.hash,
    infoHashV1,
    infoHashV2,
    category: torrent.category,
    tags: torrent.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "")
      .sort(),
    savePath: torrent.save_path,
    progress: torrent.progress,
    ratioLimit: torrent.ratio_limit,
    seedingTimeLimitMinutes: torrent.seeding_time_limit,
    inactiveSeedingTimeLimitMinutes: torrent.inactive_seeding_time_limit,
    effectiveRatioLimit: torrent.max_ratio,
    effectiveSeedingTimeLimitMinutes: torrent.max_seeding_time,
    effectiveInactiveSeedingTimeLimitMinutes: torrent.max_inactive_seeding_time,
    ratio: torrent.ratio,
    seededSeconds: torrent.seeding_time,
    shareLimitAction: torrent.share_limit_action,
    automaticManagement: torrent.auto_tmm,
    forceStarted: torrent.force_start,
    managerAssociations: [],
  });
}
/** Uses an authenticated client; only inventory GETs. Categories/tags never establish ownership. */
export async function captureTorrents(input: {
  client: Pick<QbittorrentClient, "listAll">;
  sourceInstanceId: string;
  version: string;
}) {
  const startedAt = new Date().toISOString();
  const firstObservation = await input.client.listAll();
  const first = firstObservation.map((torrent) =>
    normalizeTorrentObservation(torrent),
  );
  const secondObservation = await input.client.listAll();
  const second = secondObservation.map((torrent) =>
    normalizeTorrentObservation(torrent),
  );
  // Counter drift remains explicit; a quiescent final capture is required before review.
  const stable = recordDigest(first) === recordDigest(second);
  const snapshot = MigrationSnapshotSchema.parse({
    schemaVersion: 1,
    sourceKind: "qbittorrent",
    sourceInstanceId: input.sourceInstanceId,
    sourceVersion: input.version,
    startedAt,
    completedAt: new Date().toISOString(),
    records: second,
    endpoints: [
      {
        name: "torrents",
        pages: 2,
        records: second.length,
        digest: recordDigest(second),
        complete: stable,
        stable,
        reason: stable ? "complete" : "source_changed",
      },
    ],
  });
  return validateCapture(snapshot).snapshot;
}
