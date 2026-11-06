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
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { readLibraryMovieManagement } from "#infrastructure/movie-editions/management/authority.ts";
import { acquisitionInvocation } from "#automation/acquisition-management/invocation.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";

export type FeedMatchTarget = Prisma.MediaIntentGetPayload<{
  include: { media: { include: { parent: { include: { parent: true } } } } };
}>;

/** An unscoped feed observation cannot supply another cut's identity, consent or predecessor. */
export async function selectFeedCandidateV1(
  initial: MediaAutomationContext,
  target: FeedMatchTarget,
  source: ProviderCandidate,
) {
  const context = movieManagementContext(initial);
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
      budget: context.movieManagement.budget,
    });
    const sponsor = sponsors[0];
    if (sponsor === undefined)
      return selectManagedMovieFeedCandidate(context, target, source, access);
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
  if (demand === 0)
    return selectManagedFeedCandidate(context, target, source, access);
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

function selectManagedFeedCandidate(
  context: ReturnType<typeof movieManagementContext>,
  target: FeedMatchTarget,
  source: ProviderCandidate,
  access: Awaited<ReturnType<typeof networkMovieAccess>>,
) {
  if (target.media.kind !== "movie")
    return selectManagedEpisodeFeedCandidate(context, target, source);
  return access === undefined
    ? null
    : selectManagedMovieFeedCandidate(context, target, source, access);
}

async function selectManagedMovieFeedCandidate(
  context: ReturnType<typeof movieManagementContext>,
  target: FeedMatchTarget,
  source: ProviderCandidate,
  access: NonNullable<Awaited<ReturnType<typeof networkMovieAccess>>>,
) {
  const scope = MovieEditionScopeSchema.parse({
    mediaId: target.mediaId,
    rootMediaId: target.editionRootId,
    edition: target.edition,
  });
  const management = await readLibraryMovieManagement(
    context.db,
    { scope, epoch: target.automationEpoch, access },
    context.movieManagement,
  );
  if (management === null) return null;
  const selected = await storeMovieCandidateV4(context, scope, source, true);
  management.freshness.assertActive();
  return selected === null
    ? null
    : {
        protocol: "library-movie-v4" as const,
        selected,
        access,
        management: management.proof,
        freshness: management.freshness,
      };
}

async function selectManagedEpisodeFeedCandidate(
  context: MediaAutomationContext,
  target: FeedMatchTarget,
  source: ProviderCandidate,
) {
  const configured = await acquisitionInvocation(context, {
    mediaId: target.mediaId,
  });
  const invocation = configured.libraryManagement;
  if (invocation === undefined)
    throw new Error(
      "Managed episode feed lost its original configured invocation",
    );
  const management = await readLibrarySeriesManagement(
    context.db,
    {
      mediaIds: [target.mediaId],
      epoch: target.automationEpoch,
      access: invocation.access,
    },
    invocation,
  );
  if (management === null) return null;
  const selected = await assessDefaultFeedCandidate(
    configured,
    target.mediaId,
    source,
    invocation.budget,
  );
  management.freshness.assertActive();
  return selected === null
    ? null
    : {
        protocol: "library-episode" as const,
        selected,
        access: invocation.access,
        management: management.proof,
        freshness: management.freshness,
      };
}
