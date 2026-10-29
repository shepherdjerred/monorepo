import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { requireMovieSponsor } from "#automation/editions/choice.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";

/** A real requester remains distinct from positive household management permission. */
export async function reservationAuthority(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  input: {
    mediaId: string;
    mediaIds: string[];
    epoch: number;
    movieAccess: MovieChoiceAccess | undefined;
  },
) {
  const movie = await requireMovieSponsor(tx, input.mediaId, input.movieAccess);
  const sponsor =
    movie?.request ??
    (await tx.mediaRequest.findFirst({
      where: { mediaId: input.mediaId, ...effectiveRequestWhere },
      orderBy: { createdAt: "asc" },
    }));
  if (sponsor !== null) return { kind: "request" as const, sponsor, movie };
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error(
      "Library acquisition needs its original configured invocation",
    );
  const management = await readLibrarySeriesManagement(
    tx,
    { mediaIds: input.mediaIds, epoch: input.epoch, access: invocation.access },
    invocation,
  );
  return management === null
    ? null
    : { kind: "library" as const, sponsor: null, ...management };
}

export async function reservationMovieChoice(
  tx: Prisma.TransactionClient,
  authority: NonNullable<Awaited<ReturnType<typeof reservationAuthority>>>,
  access: MovieChoiceAccess | undefined,
) {
  if (authority.kind === "library" || authority.movie === null) return {};
  return captureMovieAttemptChoice(tx, {
    sponsorRequestId: authority.sponsor.id,
    scope: authority.movie.scope,
    access: requireMovieChoiceAccess(access ?? {}),
  });
}
