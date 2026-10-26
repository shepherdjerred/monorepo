import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import { readMovieRequestFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import {
  requireMovieChoiceAccess,
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";

/** Only the signed-in subject's demand is visible, independently of shared playback. */
export async function visibleMovieRequests(
  tx: Prisma.TransactionClient,
  input: {
    media: { id: string; kind: string };
    userId: string;
    serverMachineId: string | undefined;
    movieSectionId: string | undefined;
    movieChoiceAccess?: MovieChoiceAccess | undefined;
  },
) {
  if (input.media.kind !== "movie") return [];
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: input.media.id,
      userId: input.userId,
      active: true,
      excluded: false,
      direct: true,
    },
    orderBy: { edition: "asc" },
  });
  if (requests.length > MovieEditionKeySchema.options.length)
    throw new Error("Movie request targets exceed the closed registry");
  await lockMovieChoiceIdentities(tx, {
    mediaIds: [input.media.id],
    extraUserIds: [input.userId],
  });
  const result = [];
  for (const request of requests) {
    const covered = await tx.assetCoverage.findMany({
      where: {
        mediaId: input.media.id,
        edition: request.edition,
        current: true,
      },
      select: { asset: { select: { id: true, version: true } } },
      take: 2,
    });
    if (covered.length > 1)
      throw new Error("Movie target has multiple current physical assets");
    const asset = covered[0]?.asset;
    let fulfillment: MovieEditionFulfillment;
    try {
      fulfillment = await readMovieRequestFulfillment(tx, {
        requestId: request.id,
        currentAsset:
          asset === undefined
            ? null
            : { assetId: asset.id, assetVersion: asset.version },
        access: requireMovieChoiceAccess(input.movieChoiceAccess ?? input),
      });
    } catch (error) {
      if (
        !(error instanceof MediaError) ||
        error.code !== "plex_scope_unconfigured"
      )
        throw error;
      fulfillment = { status: "protected", reason: error.code };
    }
    result.push({
      requestId: request.id,
      edition: MovieEditionKeySchema.parse(request.edition),
      fulfillment,
    });
  }
  return result;
}
