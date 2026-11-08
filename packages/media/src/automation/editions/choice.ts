import type { Prisma } from "#generated/prisma/client.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import {
  assertMovieAttemptChoice,
  eligibleAcquisitionSponsors,
} from "#infrastructure/movie-editions/authority.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";

export async function assertAttemptMovieChoice(
  tx: Prisma.TransactionClient,
  attemptId: string,
  access: MovieChoiceAccess | undefined,
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const movie = await tx.mediaItem.findFirst({
    where: { id: { in: attempt.mediaIds }, kind: "movie" },
  });
  if (movie === null) return null;
  return await assertMovieAttemptChoice(tx, {
    attemptId,
    purpose: "new_acquisition_effect",
    access: requireMovieChoiceAccess(access ?? {}),
  });
}

export async function requireMovieSponsor(
  tx: Prisma.TransactionClient,
  mediaId: string,
  access: MovieChoiceAccess | undefined,
) {
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
  });
  if (media.kind !== "movie") return null;
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope: { rootMediaId: mediaId, mediaId, edition: "default" },
    access: requireMovieChoiceAccess(access ?? {}),
  });
  const sponsor = sponsors[0];
  if (sponsor === undefined)
    throw new MovieChoiceProtection("movie_edition_choice_required");
  return sponsor;
}
