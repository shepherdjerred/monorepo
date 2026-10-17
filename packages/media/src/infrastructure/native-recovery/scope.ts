import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeRecoveryScopeSchema,
  type PrepareNativeRecoverySchema,
} from "#shared/native-recovery.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { snapshotNativeSubtitles } from "#automation/native-subtitles/snapshot.ts";
import { snapshotNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import { RecoveryInputSchema } from "#infrastructure/recovery.ts";
import { resolveNativeStorageRoots } from "./storage-provenance.ts";
import {
  nativeHousehold,
  nativeLifecycle,
  nativeJson,
  nativeAttempt,
} from "./snapshots.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { torrentIdentity } from "#migration/handoff-network/torrents.ts";

function stableTorrentObservation(raw: unknown) {
  const observed = z
    .object({ torrent: StoredTorrentObservationSchema })
    .parse(raw);
  const normalized = normalizeTorrentObservation(observed.torrent);
  if (normalized.kind !== "torrent")
    throw new Error("Native torrent has invalid observation kind");
  return { identity: torrentIdentity(normalized) };
}

export async function assertNativeRestore(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PrepareNativeRecoverySchema>,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.restoreOperationId },
  });
  const request = RecoveryInputSchema.parse(operation.payload);
  const result = z
    .strictObject({
      recoveryId: z.uuid(),
      previousEpoch: z.int().nonnegative(),
      recoveryEpoch: z.int().positive(),
      mode: z.literal("observe"),
    })
    .parse(operation.result);
  if (
    operation.kind !== "restore_observe" ||
    operation.status !== "completed" ||
    operation.idempotencyKey !== `restore-observe:${request.recoveryId}` ||
    result.recoveryId !== request.recoveryId ||
    result.previousEpoch !== request.expectedEpoch ||
    result.recoveryEpoch !== result.previousEpoch + 1 ||
    result.recoveryEpoch !== input.recoveryEpoch
  )
    throw new Error(
      "Native recovery requires the exact completed restore observation",
    );
  return result;
}

export async function buildNativeScope(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PrepareNativeRecoverySchema>,
) {
  await assertNativeRestore(tx, input);
  const assetIds = [...new Set(input.assetIds)].sort();
  if (assetIds.length !== input.assetIds.length)
    throw new Error("Native recovery duplicate asset selection");
  const assets = await tx.libraryAsset.findMany({
    where: { id: { in: assetIds } },
    include: {
      coverage: { where: { current: true }, orderBy: { mediaId: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  if (
    assets.length !== assetIds.length ||
    assets.some(
      (row) =>
        !row.owned ||
        row.state !== "published" ||
        row.checksum === null ||
        row.ownershipEpoch < 0 ||
        row.ownershipEpoch >= input.recoveryEpoch ||
        row.coverage.length === 0,
    )
  )
    throw new Error(
      "Native recovery requires owned published assets from an earlier epoch",
    );
  const ids = [
    ...new Set(
      assets.flatMap((row) => row.coverage.map((item) => item.mediaId)),
    ),
  ].sort();
  if (ids.length > 100)
    throw new Error("Native recovery coverage bound exceeded");
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: {
      intent: { include: { profile: true } },
      parent: { include: { parent: true } },
    },
    orderBy: { id: "asc" },
  });
  if (
    rows.length !== ids.length ||
    rows.some((row) => !["movie", "episode"].includes(row.kind))
  )
    throw new Error("Native recovery unresolved physical coverage");
  if (
    (await tx.assetCoverage.count({
      where: {
        mediaId: { in: ids },
        current: true,
        assetId: { notIn: assetIds },
      },
    })) > 0
  )
    throw new Error(
      "Native recovery requires complete current physical coverage",
    );
  const files = [];
  for (const asset of assets) {
    const kinds = new Set(
      rows
        .filter((row) => asset.coverage.some((item) => item.mediaId === row.id))
        .map((row) => row.kind),
    );
    if (kinds.size !== 1)
      throw new Error("Native recovery mixed physical coverage");
    const libraryKind = kinds.has("movie") ? "movies" : "tv";
    const relative = path.relative(`/data/${libraryKind}`, asset.path);
    if (
      relative.length === 0 ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    )
      throw new Error("Native recovery path outside canonical library");
    files.push({
      assetId: asset.id,
      assetVersion: asset.version,
      canonicalPath: asset.path,
      libraryKind,
      checksum: asset.checksum,
      sizeBytes: asset.sizeBytes.toString(),
      ownershipEpoch: asset.ownershipEpoch,
      properties: asset.properties,
      mediaIds: asset.coverage.map((row) => row.mediaId),
      subtitles: await snapshotNativeSubtitles(tx, asset.id),
    });
  }
  const torrents = await tx.torrent.findMany({
    where: { assets: { some: { id: { in: assetIds } } } },
    include: { attempts: { orderBy: { id: "asc" }, take: 101 } },
    orderBy: { id: "asc" },
  });
  const ancestry = rows.flatMap((row) =>
    [row.parent?.id, row.parent?.parent?.id].filter((id) => id !== undefined),
  );
  return NativeRecoveryScopeSchema.parse({
    schemaVersion: 1,
    request: { ...input, assetIds },
    media: rows.map(({ intent, parent, ...row }) => ({
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
        intent === null ? null : nativeJson({ ...intent, profile: undefined }),
      profile:
        intent?.profile === undefined || intent.profile === null
          ? null
          : {
              id: intent.profile.id,
              version: intent.profile.version,
              rules: QualityRulesSchema.parse(intent.profile.rules),
            },
    })),
    files,
    storageRoots: await resolveNativeStorageRoots(tx),
    subtitlePolicies: await snapshotNativeSubtitlePolicies(tx, ids),
    household: await nativeHousehold(tx, ids, ancestry),
    lifecycle: await nativeLifecycle(tx, ids, assetIds),
    torrents: torrents.map((row) => ({
      id: row.id,
      infoHash: row.infoHash,
      qbittorrentId: row.qbittorrentId,
      state: row.state,
      owned: row.owned,
      ownershipEpoch: row.ownershipEpoch,
      seedingPolicy: row.seedingPolicy,
      observation: stableTorrentObservation(row.observation),
      attempts: row.attempts.map((attempt) => nativeAttempt(attempt)),
    })),
  });
}
