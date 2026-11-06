import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieRetrySourceV4, captureMovieRetryV1 } from "./retry-source.ts";
import { readMoviePreparedRetrySourceV2 } from "./retry-continuation-source.ts";
import { readCompletedMovieRetryAdmissionV1 } from "./retry-completed-admission.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MediaError } from "#application/errors.ts";

/** The actual locked phase selects an additive protocol; absent reservations never create synthetic attempts. */
export async function selectMovieRetryV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    mode: "manual" | "automatic";
    access?: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
    include: { attempt: true },
  });
  if (reservation === null) {
    if (input.access === undefined)
      throw new MediaError(
        "movie_retry_attempt_required",
        "Automatic movie recovery has no current reserved acquisition",
        409,
      );
    return readCompletedMovieRetryAdmissionV1(
      tx,
      { ...input, access: input.access },
      budget,
    );
  }
  budget.consume(1);
  if (reservation.attempt.filePlan !== null)
    return readMoviePreparedRetrySourceV2(
      tx,
      { ...input, attemptId: reservation.attemptId },
      budget,
    );
  const source = await readMovieRetrySourceV4(
    tx,
    { attemptId: reservation.attemptId, scope: input.scope },
    budget,
  );
  return {
    kind: "initial" as const,
    source,
    capture: captureMovieRetryV1(source, input.mode),
  };
}

export function movieRetrySelectionDetails(
  selected: Awaited<ReturnType<typeof selectMovieRetryV4>>,
): Prisma.InputJsonObject {
  switch (selected.kind) {
    case "initial":
      return { movieRetryV1: selected.capture };
    case "continuation":
      return { movieRetryV2: selected.capture };
    case "plex_committed":
      return { movieRetryPlexAckV1: selected.capture };
  }
}
