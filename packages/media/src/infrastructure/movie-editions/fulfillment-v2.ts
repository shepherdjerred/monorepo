import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  cutCanonical,
  currentCuts,
} from "#infrastructure/editions/cut-context.ts";
import { parseMovieCutV2 } from "#domain/editions/parse-v2.ts";
import { evaluateMovieCutV2 } from "#domain/editions/selection-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Current owned bytes and exact v2 Plex binding are checked by the caller; retain all original cut facts. */
export async function movieCutFulfillmentV2(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  assetId: string,
  budget?: PublicationAuthorityReadBudget,
): Promise<MovieEditionFulfillment> {
  try {
    const canonical = await cutCanonical(tx, [scope.mediaId]);
    const retained = await currentCuts(tx, canonical, {
      mediaIds: [],
      predecessorAssetIds: [assetId],
      ...(budget === undefined ? {} : { budget }),
    });
    const evidence = retained.map((prior) =>
      parseMovieCutV2({
        source: prior.source,
        sourceDigest: prior.sourceDigest,
        canonical,
        attribution: prior.attribution,
        texts: prior.texts.map(({ text, provenance }) => ({
          text,
          provenance,
        })),
      }),
    );
    const candidate = evidence[0];
    if (candidate === undefined)
      throw new Error("Movie fulfillment lost retained cut provenance");
    const decision = evaluateMovieCutV2({
      edition: scope.edition,
      phase: "candidate",
      candidate,
      current: evidence.slice(1),
      members: [],
    });
    return decision.accepted
      ? { status: "fulfilled", reason: null }
      : {
          status: "protected",
          reason: "movie_edition_asset_mismatch",
        };
  } catch (error) {
    if (
      error instanceof MediaError &&
      error.code === "edition_provenance_missing"
    )
      return { status: "protected", reason: "movie_edition_asset_mismatch" };
    throw error;
  }
}
