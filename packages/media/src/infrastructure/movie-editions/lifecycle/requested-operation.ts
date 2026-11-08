import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";

export async function requestedMovieOperationV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    generation: number;
    request: { id: string; version: number };
  },
) {
  const quarantined = await tx.assetCoverage.count({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
      asset: { edition: input.scope.edition, state: "quarantined" },
    },
  });
  return {
    kind:
      quarantined > 0
        ? "restore_movie_edition_v4"
        : "reconcile_movie_edition_v4",
    mediaId: input.scope.mediaId,
    generation: input.generation,
    details: {
      schemaVersion: 4,
      scope: input.scope,
      requestId: input.request.id,
      requestVersion: input.request.version,
      cursor: null,
    },
  };
}
