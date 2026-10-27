import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { assessDefaultFeedCandidate } from "#automation/acquisition-candidates.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieSponsor } from "#automation/editions/choice.ts";
import { storeMovieCandidateV4 } from "#automation/movie-editions/candidates.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

export type FeedMatchTarget = Prisma.MediaIntentGetPayload<{
  include: { media: { include: { parent: { include: { parent: true } } } } };
}>;

/** An unscoped feed observation cannot supply another cut's identity, consent or predecessor. */
export async function selectFeedCandidateV1(
  context: MediaAutomationContext,
  target: FeedMatchTarget,
  source: ProviderCandidate,
) {
  const access = await networkMovieAccess(context, [target.mediaId]);
  if (target.media.kind === "movie" && target.edition !== "default") {
    if (access === undefined)
      throw new Error("Movie feed matching lost configured access");
    const scope = MovieEditionScopeSchema.parse({
      mediaId: target.mediaId,
      rootMediaId: target.editionRootId,
      edition: target.edition,
    });
    const sponsors = await eligibleAcquisitionSponsors(context.db, {
      scope,
      access,
      protocol: "movie-v4",
    });
    const sponsor = sponsors[0];
    if (sponsor === undefined) return null;
    const selected = await storeMovieCandidateV4(context, scope, source, true);
    sponsor.freshness.assertActive();
    return selected === null
      ? null
      : {
          protocol: "movie-v4" as const,
          selected,
          access,
          freshness: sponsor.freshness,
        };
  }
  if (target.edition !== "default") {
    throw new Error(
      "TV feed matching requires the actual default episode scope",
    );
  }
  const demand = await context.db.mediaRequest.count({
    where: { mediaId: target.mediaId, ...effectiveRequestWhere },
  });
  if (demand === 0) return null;
  try {
    const sponsor = await requireMovieSponsor(
      context.db,
      target.mediaId,
      access,
    );
    const selected = await assessDefaultFeedCandidate(
      context,
      target.mediaId,
      source,
    );
    sponsor?.freshness.assertActive();
    return selected === null
      ? null
      : {
          protocol: "default" as const,
          selected,
          access,
          freshness: sponsor?.freshness,
        };
  } catch (error) {
    if (error instanceof MovieChoiceProtection) return null;
    throw error;
  }
}
