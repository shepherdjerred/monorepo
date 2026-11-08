import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueMovieSubtitleTargetsV4 } from "#automation/movie-editions/subtitles/queue.ts";

/** New personal caption requirements use the already owned selected video, without replaying acquisition. */
export async function queueRequestedMovieCaptionsV4(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.assetCoverage.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
    },
    include: { asset: true },
    take: 2,
  });
  if (rows.length > 1)
    throw new Error("Movie request has multiple current physical videos");
  const asset = rows[0]?.asset;
  if (asset?.state !== "published") return;
  await queueMovieSubtitleTargetsV4(
    tx,
    { ...input, assetId: asset.id },
    budget,
  );
}
