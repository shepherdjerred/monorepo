import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import { historicalDefaultIntent } from "#infrastructure/native-recovery/legacy-snapshot.ts";
import {
  nativeJson,
  nativeAttempt,
} from "#infrastructure/native-recovery/snapshots.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { torrentIdentity } from "#migration/handoff-network/torrents.ts";

export async function archiveMedia(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: {
      intents: { where: { edition: "default" }, include: { profile: true } },
      parent: { include: { parent: true } },
    },
    orderBy: { id: "asc" },
  });
  if (
    rows.length !== ids.length ||
    rows.some((row) => !["movie", "episode"].includes(row.kind))
  )
    throw new Error("Archive coverage has unresolved leaves");
  return rows.map((row) => {
    const intent = defaultIntent(row.intents);
    const parent = row.parent;
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      version: row.version,
      tmdbId: row.tmdbId,
      externalIds: row.externalIds,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      parent:
        parent === null
          ? null
          : {
              id: parent.id,
              version: parent.version,
              tmdbId: parent.tmdbId,
              externalIds: parent.externalIds,
              parent:
                parent.parent === null
                  ? null
                  : {
                      id: parent.parent.id,
                      version: parent.parent.version,
                      tmdbId: parent.parent.tmdbId,
                      externalIds: parent.parent.externalIds,
                    },
            },
      intent:
        intent === null
          ? null
          : nativeJson({
              ...historicalDefaultIntent(intent),
              profile: undefined,
            }),
      profile:
        intent?.profile == null
          ? null
          : {
              id: intent.profile.id,
              version: intent.profile.version,
              rules: QualityRulesSchema.parse(intent.profile.rules),
            },
    };
  });
}
export async function archiveTorrents(
  tx: Prisma.TransactionClient,
  assetIds: string[],
) {
  const rows = await tx.torrent.findMany({
    where: { assets: { some: { id: { in: assetIds } } } },
    include: { attempts: { orderBy: { id: "asc" }, take: 101 } },
    orderBy: { id: "asc" },
    take: 26,
  });
  if (rows.length > 25 || rows.some((row) => row.attempts.length > 100))
    throw new Error("Archive torrent evidence bound exceeded");
  return rows.map((row) => {
    const observed = z
      .object({ torrent: StoredTorrentObservationSchema })
      .parse(row.observation);
    const normalized = normalizeTorrentObservation(observed.torrent);
    if (normalized.kind !== "torrent")
      throw new Error("Archive torrent evidence invalid");
    return {
      id: row.id,
      infoHash: row.infoHash,
      qbittorrentId: row.qbittorrentId,
      state: row.state,
      owned: row.owned,
      ownershipEpoch: row.ownershipEpoch,
      seedingPolicy: row.seedingPolicy,
      observation: { identity: torrentIdentity(normalized) },
      attempts: row.attempts.map((attempt) => nativeAttempt(attempt)),
    };
  });
}
