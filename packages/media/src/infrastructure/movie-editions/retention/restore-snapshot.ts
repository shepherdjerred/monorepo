import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieRestoreAssetV1Schema } from "#shared/movie-editions/restore-v1.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";

/** Capture every caption row, keeping independently owned history outside the video transition. */
export async function snapshotMovieRestoreAssetV1(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  assetId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { coverage: { orderBy: { mediaId: "asc" }, take: 2 } },
  });
  budget.consume(1 + asset.coverage.length);
  const rows = await tx.subtitleAsset.findMany({
    where: { assetId },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  const physical = await tx.subtitleAsset.findMany({
    where: {
      assetId,
      state: { in: ["installed", "quarantined"] },
      AND: [videoSubtitleWhere],
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(physical.length);
  const ids = new Set(physical.map((row) => row.id));
  const subtitles = rows.map((row) => publicationSubtitleSnapshot(row));
  if (
    physical.some(
      (row) => !subtitles.some((subtitle) => subtitle.id === row.id),
    )
  )
    throw new Error("Movie restore caption inventory changed during its read");
  return MovieRestoreAssetV1Schema.parse({
    schemaVersion: 2,
    scope,
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
    subtitles: subtitles.filter((row) => ids.has(row.id)),
    subtitleHistory: subtitles.filter((row) => !ids.has(row.id)),
  });
}
