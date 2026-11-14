import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { FileGuardError } from "#automation/files/types.ts";

export async function maintenanceScopeV1(
  context: MediaAutomationContext,
  assetId: string,
) {
  const asset = await context.db.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      coverage: { where: { current: true }, take: 2, include: { media: true } },
    },
  });
  if (asset.coverage.length !== 1 || asset.coverage[0] === undefined)
    throw new FileGuardError("subtitle_coverage_requires_review");
  const coverage = asset.coverage[0];
  const movieScope =
    coverage.media.kind === "movie" && asset.editionRootId !== null
      ? MovieEditionScopeSchema.parse({
          rootMediaId: asset.editionRootId,
          mediaId: coverage.mediaId,
          edition: asset.edition,
        })
      : undefined;
  const access =
    movieScope === undefined
      ? undefined
      : await networkMovieAccess(context, [coverage.mediaId]);
  return { movieScope, access };
}
export async function maintenanceWorkV1(
  tx: Prisma.TransactionClient,
  input: {
    assetId: string;
    epoch: number;
    resolved: Awaited<ReturnType<typeof maintenanceScopeV1>>;
  },
) {
  if (
    (await tx.subtitleAsset.count({ where: { assetId: input.assetId } })) > 100
  )
    throw new FileGuardError(
      "subtitle_inventory_requires_bounded_reconciliation",
    );
  const { movieScope, access } = input.resolved;
  if (movieScope === undefined)
    return currentSubtitleWork(tx, input.assetId, input.epoch);
  if (access === undefined)
    throw new FileGuardError("subtitle_movie_access_unavailable");
  return currentMovieSubtitleWorkV4(
    tx,
    { scope: movieScope, assetId: input.assetId, epoch: input.epoch, access },
    new PublicationAuthorityReadBudget(),
  );
}
