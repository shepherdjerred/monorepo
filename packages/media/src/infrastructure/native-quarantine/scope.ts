import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineDecisionSchema,
  type PrepareNativeQuarantineSchema,
} from "#shared/native-recovery/quarantine.ts";
import { assertNativeRestore } from "#infrastructure/native-recovery/scope.ts";
import {
  nativeHousehold,
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { snapshotNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import { snapshotQuarantinedSubtitles } from "#automation/native-quarantine/subtitles.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { torrentIdentity } from "#migration/handoff-network/torrents.ts";
import { assertQuarantineGroupAuthority } from "./prior-authority.ts";

export async function buildNativeQuarantineScope(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PrepareNativeQuarantineSchema>,
) {
  await assertNativeRestore(tx, input);
  const assetIds = [...new Set(input.assetIds)].sort();
  if (assetIds.length !== input.assetIds.length)
    throw new Error("Duplicate native quarantine selection");
  await assertNoSubtitleReplacement(tx, assetIds);
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
      (asset) =>
        !asset.owned ||
        asset.state !== "quarantined" ||
        asset.checksum === null ||
        asset.ownershipEpoch < 0 ||
        asset.ownershipEpoch >= input.recoveryEpoch ||
        asset.coverage.length === 0,
    )
  )
    throw new Error(
      "Select complete owned quarantined files from the restored epoch",
    );
  const ids = [
    ...new Set(
      assets.flatMap((asset) => asset.coverage.map((row) => row.mediaId)),
    ),
  ].sort();
  if (ids.length > 100)
    throw new Error("Native quarantine coverage exceeds 100 leaves");
  if (
    await tx.assetCoverage.count({
      where: {
        mediaId: { in: ids },
        current: true,
        assetId: { notIn: assetIds },
      },
    })
  )
    throw new Error("Select every file in the physical quarantine group");
  const media = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: {
      intent: { include: { profile: true } },
      parent: { include: { parent: true } },
    },
    orderBy: { id: "asc" },
  });
  if (
    media.length !== ids.length ||
    media.some(
      (item) =>
        !["movie", "episode"].includes(item.kind) ||
        item.availability !== "quarantined",
    )
  )
    throw new Error("Native quarantine has inconsistent media coverage");
  const decisions = await tx.retentionDecision.findMany({
    where: { mediaId: { in: ids }, state: "quarantined" },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (
    decisions.length !== ids.length ||
    new Set(decisions.map((row) => row.mediaId)).size !== ids.length
  )
    throw new Error(
      "Native quarantine requires one committed decision per covered leaf",
    );
  const groups = quarantineGroups(decisions, assetIds, ids);
  const files = [];
  for (const asset of assets) {
    const group = groups.find((item) => item.assetIds.includes(asset.id));
    if (group === undefined)
      throw new Error("Native quarantine manifest omitted asset");
    const first = group.decisions[0];
    if (first === undefined)
      throw new Error("Native quarantine decision missing");
    const entry = RemovalPlanSchema.parse(first.manifest).assets.find(
      (item) => item.assetId === asset.id,
    );
    if (
      entry?.checksum !== asset.checksum ||
      path.posix.join(`/data/${entry.libraryKind}`, entry.libraryPath) !==
        asset.path ||
      snapshotHash([...entry.mediaIds].sort()) !==
        snapshotHash(asset.coverage.map((row) => row.mediaId).sort())
    )
      throw new Error(
        "Native quarantine committed manifest disagrees with owned file",
      );
    files.push({
      assetId: asset.id,
      assetVersion: asset.version,
      canonicalPath: asset.path,
      libraryPath: entry.libraryPath,
      libraryKind: entry.libraryKind,
      quarantineId: entry.quarantineId,
      groupHash: group.groupHash,
      checksum: asset.checksum,
      sizeBytes: asset.sizeBytes.toString(),
      ownershipEpoch: asset.ownershipEpoch,
      properties: z.json().parse(asset.properties),
      mediaIds: entry.mediaIds,
      subtitles: await snapshotQuarantinedSubtitles(tx, asset.id),
      sidecars: entry.sidecars,
    });
  }
  for (const group of groups)
    await assertQuarantineGroupAuthority(
      tx,
      group,
      files.filter((file) => group.assetIds.includes(file.assetId)),
    );
  const ancestry = media.flatMap((item) =>
    [item.parent?.id, item.parent?.parent?.id].filter((id) => id !== undefined),
  );
  return NativeQuarantineScopeSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "committed_quarantine",
    request: { ...input, assetIds },
    groups,
    files,
    media: media.map(({ intent, parent, ...item }) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      version: item.version,
      tmdbId: item.tmdbId,
      externalIds: item.externalIds,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
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
        intent?.profile == null
          ? null
          : {
              id: intent.profile.id,
              version: intent.profile.version,
              rules: QualityRulesSchema.parse(intent.profile.rules),
            },
    })),
    storageRoots: await resolveNativeStorageRoots(tx),
    subtitlePolicies: await snapshotNativeSubtitlePolicies(tx, ids),
    household: await nativeHousehold(tx, ids, ancestry),
    lifecycle: await quarantineLifecycle(tx, ids, assetIds),
    torrents: await quarantineTorrents(tx, assetIds),
  });
}

function quarantineGroups(
  rows: Prisma.RetentionDecisionGetPayload<object>[],
  assetIds: string[],
  mediaIds: string[],
) {
  const byManifest = new Map<
    string,
    z.infer<typeof NativeQuarantineDecisionSchema>[]
  >();
  for (const row of rows) {
    const manifest = RemovalPlanSchema.parse(row.manifest);
    const manifestHash = snapshotHash(z.json().parse(manifest));
    const evidence = z
      .object({ recoveryEpoch: z.int().nonnegative() })
      .parse(row.evidence);
    const decision = NativeQuarantineDecisionSchema.parse({
      id: row.id,
      mediaId: row.mediaId,
      version: row.version,
      generation: row.generation,
      evidence: row.evidence,
      manifest,
      manifestHash,
      recoveryEpoch: evidence.recoveryEpoch,
      quarantinedAt: row.quarantinedAt?.toISOString(),
      purgeAfter: row.purgeAfter?.toISOString(),
    });
    const siblings = byManifest.get(manifestHash) ?? [];
    siblings.push(decision);
    byManifest.set(manifestHash, siblings);
  }
  const groups = [];
  for (const [manifestHash, decisions] of byManifest) {
    const first = decisions[0];
    if (first === undefined)
      throw new Error("Quarantine group missing decisions");
    const entries = RemovalPlanSchema.parse(first.manifest).assets;
    const assets = entries.map((entry) => entry.assetId).sort();
    const leaves = [
      ...new Set(entries.flatMap((entry) => entry.mediaIds)),
    ].sort();
    if (
      new Set(assets).size !== assets.length ||
      assets.some((id) => !assetIds.includes(id)) ||
      leaves.some((id) => !mediaIds.includes(id)) ||
      snapshotHash(leaves) !==
        snapshotHash(decisions.map((row) => row.mediaId).sort()) ||
      decisions.some(
        (row) =>
          row.recoveryEpoch !== first.recoveryEpoch ||
          row.quarantinedAt !== first.quarantinedAt ||
          row.purgeAfter !== first.purgeAfter,
      )
    )
      throw new Error("Quarantine group is partial or overlapping");
    groups.push({
      groupHash: snapshotHash({ manifestHash, decisions }),
      assetIds: assets,
      mediaIds: leaves,
      decisions,
    });
  }
  if (
    new Set(groups.flatMap((group) => group.assetIds)).size !==
    groups.flatMap((group) => group.assetIds).length
  )
    throw new Error("Quarantine manifests overlap");
  return groups.sort((a, b) => a.groupHash.localeCompare(b.groupHash));
}

async function quarantineLifecycle(
  tx: Prisma.TransactionClient,
  mediaIds: string[],
  assetIds: string[],
) {
  const attempts = await tx.acquisitionAttempt.findMany({
    where: { mediaIds: { hasSome: mediaIds } },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (
    attempts.length > 100 ||
    attempts.some(
      (row) =>
        !["completed", "cancelled", "obsolete", "rolled_back"].includes(
          row.state,
        ),
    ) ||
    (await tx.acquisitionReservation.count({
      where: { mediaId: { in: mediaIds } },
    })) ||
    (await tx.upgradeCleanup.count({
      where: {
        OR: [
          { assetId: { in: assetIds } },
          { successorAssetId: { in: assetIds } },
        ],
      },
    }))
  )
    throw new Error(
      "Quarantine acquisition or archive lifecycle requires separate reconciliation",
    );
  return { attempts: attempts.map((attempt) => nativeAttempt(attempt)) };
}

async function quarantineTorrents(
  tx: Prisma.TransactionClient,
  assetIds: string[],
) {
  const rows = await tx.torrent.findMany({
    where: { assets: { some: { id: { in: assetIds } } } },
    include: { attempts: { orderBy: { id: "asc" }, take: 101 } },
    orderBy: { id: "asc" },
    take: 26,
  });
  return rows.map((row) => {
    const stored = z
      .object({ torrent: StoredTorrentObservationSchema })
      .parse(row.observation);
    const normalized = normalizeTorrentObservation(stored.torrent);
    if (normalized.kind !== "torrent")
      throw new Error("Invalid quarantine torrent evidence");
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
