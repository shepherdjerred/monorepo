import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { MoviePublicationAssetV2Schema } from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";

/** One call-local authority budget covers every actual parent, coverage and repeated subtitle query. */
export async function snapshotMoviePublicationAssetV2(
  tx: Prisma.TransactionClient,
  input: MovieEditionScope,
  assetId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const scope = MovieEditionScopeSchema.parse(input);
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { coverage: { orderBy: { mediaId: "asc" }, take: 2 } },
  });
  budget.consume(1 + asset.coverage.length);
  if (
    asset.edition !== scope.edition ||
    asset.editionRootId !== scope.rootMediaId ||
    asset.coverage.length !== 1 ||
    asset.coverage[0]?.mediaId !== scope.mediaId ||
    asset.coverage[0].edition !== scope.edition
  )
    throw new Error(
      "Movie publication snapshot belongs to another physical scope",
    );
  const subtitles = await tx.subtitleAsset.findMany({
    where: { assetId },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(subtitles.length);
  const physical = await tx.subtitleAsset.findMany({
    where: {
      assetId,
      state: { in: ["installed", "superseded"] },
      AND: [videoSubtitleWhere],
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(physical.length);
  if (
    physical.some(
      (row) => !subtitles.some((subtitle) => subtitle.id === row.id),
    )
  )
    throw new Error(
      "Movie publication subtitle inventory changed during its read",
    );
  const ids = new Set(physical.map((row) => row.id));
  const snapshots = subtitles.map((row) => publicationSubtitleSnapshot(row));
  return MoviePublicationAssetV2Schema.parse({
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
    subtitles: snapshots.filter((row) => ids.has(row.id)),
    subtitleHistory: snapshots.filter((row) => !ids.has(row.id)),
  });
}
