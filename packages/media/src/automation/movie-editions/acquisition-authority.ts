import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import {
  readLibraryMovieManagement,
  type MovieManagementInvocation,
} from "#infrastructure/movie-editions/management/authority.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";

/** Real personal consent and owner-approved library management are distinct sources of new acquisition authority. */
export async function requireMovieAcquisitionAuthorityV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  access: MovieChoiceAccess,
  invocation: MovieManagementInvocation,
) {
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope,
    access,
    protocol: "movie-v4",
  });
  const sponsor = sponsors[0];
  if (sponsor !== undefined) {
    sponsor.freshness.assertActive();
    return { kind: "request" as const, sponsor, freshness: sponsor.freshness };
  }
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const management = await readLibraryMovieManagement(
    tx,
    { scope, access, epoch: target.automationEpoch },
    invocation,
  );
  if (management === null)
    throw new MovieChoiceProtection("movie_edition_choice_required");
  return { kind: "library" as const, ...management };
}
