import { createHash } from "node:crypto";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { PublicationAssetSnapshotSchema } from "#shared/publication-proof/intent.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

/** Same literal subtitle projection in both publication snapshot versions. */
export function publicationSubtitleSnapshot(row: SubtitleAsset) {
  return {
    id: row.id,
    assetId: row.assetId,
    version: row.version,
    ownershipEpoch: row.ownershipEpoch,
    state: row.state,
    qualityStatus: row.qualityStatus,
    storageKind: row.storageKind,
    language: row.language,
    providerId: row.providerId,
    path: row.path,
    checksum: row.checksum,
    videoChecksum: row.videoChecksum,
    videoVersion: row.videoVersion,
    forced: row.forced,
    hearingImpaired: row.hearingImpaired,
    streamIndex: row.streamIndex,
    codec: row.codec,
    provenance: nativeJson(row.provenance),
    matchingEvidence: nativeJson(row.matchingEvidence),
    contentChecksum:
      row.content === null
        ? null
        : createHash("sha256").update(row.content).digest("hex"),
  };
}

/** Exact DB counterpart of a physical observation; never supplies filesystem identity. */
export async function snapshotPublicationAsset(
  tx: Prisma.TransactionClient,
  assetId: string,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { coverage: { orderBy: { mediaId: "asc" } } },
  });
  const subtitles = await tx.subtitleAsset.findMany({
    where: { assetId },
    orderBy: { id: "asc" },
  });
  const physical = await tx.subtitleAsset.findMany({
    where: {
      assetId,
      state: { in: ["installed", "superseded"] },
      AND: [videoSubtitleWhere],
    },
    select: { id: true },
  });
  const physicalIds = new Set(physical.map((row) => row.id));
  const snapshots = subtitles.map((row) => publicationSubtitleSnapshot(row));
  return PublicationAssetSnapshotSchema.parse({
    id: asset.id,
    version: asset.version,
    edition: asset.edition,
    editionRootId: asset.editionRootId,
    owned: asset.owned,
    ownershipEpoch: asset.ownershipEpoch,
    state: asset.state,
    path: asset.path,
    sourcePath: asset.sourcePath,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes.toString(),
    properties: asset.properties,
    supersededByAssetId: asset.supersededByAssetId,
    plexPublishedAt: asset.plexPublishedAt?.toISOString() ?? null,
    rollbackExpiresAt: asset.rollbackExpiresAt?.toISOString() ?? null,
    coverage: asset.coverage.map(({ mediaId, edition, current }) => ({
      mediaId,
      edition,
      current,
    })),
    subtitles: snapshots.filter((row) => physicalIds.has(row.id)),
    subtitleHistory: snapshots.filter((row) => !physicalIds.has(row.id)),
  });
}
