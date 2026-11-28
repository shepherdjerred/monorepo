import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import {
  ProviderAdmissionDeferred,
  ProviderIdSchema,
} from "#automation/providers.ts";
import { MediaError } from "#application/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { movieAssessmentContext } from "#infrastructure/movie-editions/release-assessment.ts";
import { rejectedMovieSourceHashesV1 } from "#infrastructure/movie-editions/rollback/rejected-sources.ts";
import { IntegrationError } from "#integrations/http.ts";
import type {
  ProviderCandidate,
  ProviderSearch,
} from "#integrations/providers.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type {
  MovieProviderSearchProgressV4,
  MovieReconcileOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { requireMovieAcquisitionAuthorityV4 } from "./acquisition-authority.ts";
import { MovieCandidateSearchProgress } from "./candidate-search-progress.ts";
import { listMovieCandidateV4 } from "./candidates.ts";
import { movieManagementContext } from "./management-context.ts";
import { queueMovieSearchDelay } from "./provider-search-delay.ts";

export class MovieProviderSearchDeferredV4 extends ProviderAdmissionDeferred {
  constructor(
    deferred: ProviderAdmissionDeferred,
    readonly progress: MovieProviderSearchProgressV4,
  ) {
    super(deferred.service, deferred.retryAt, deferred.admission);
  }
}

export async function searchMovieCandidatesV4(
  initial: MediaAutomationContext,
  input: MovieEditionScope,
  continuation?: Pick<
    MovieReconcileOperationV4,
    "operationId" | "generation" | "providerSearchProgress"
  >,
) {
  const context = movieManagementContext(initial);
  const scope = MovieEditionScopeSchema.parse(input);
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [scope.mediaId])) ?? {},
  );
  await requireMovieAcquisitionAuthorityV4(
    context.db,
    scope,
    access,
    context.movieManagement,
  );
  const target = await movieAssessmentContext(context.db, scope);
  const providers = await context.db.mediaProvider.findMany({
    where: { enabled: true, id: { in: ProviderIdSchema.options } },
    orderBy: { id: "asc" },
  });
  const rejected = await rejectedMovieSourceHashesV1(
    context.db,
    scope,
    context.movieManagement.budget,
  );
  const query = { query: target.media.title, kind: "movie" as const, page: 1 };
  // Only stable search criteria bind progress: successful admission itself
  // changes updatedAt/lastError and lease timestamps, so none belongs here.
  const criteriaDigest = identityHash({
    operationId: continuation?.operationId ?? null,
    generation: continuation?.generation ?? null,
    scope,
    query,
    canonicalHash: target.canonicalHash,
    profile: target.profile,
    rejected: [...rejected].sort(),
    providers: providers.map((provider) => ({
      id: provider.id,
      configuration: provider.configuration,
      credentialId: provider.credentialId,
    })),
  });
  const progress = new MovieCandidateSearchProgress(
    criteriaDigest,
    continuation?.providerSearchProgress,
  );
  const providerIds = providers.map(({ id }) => ProviderIdSchema.parse(id));
  const deferred = await collectMovieProviderPass(context, {
    providerIds,
    scope,
    access,
    query,
    rejected,
    progress,
    paged: continuation !== undefined,
  });
  if (continuation !== undefined && !progress.atLimit) {
    if (deferred !== undefined)
      throw new MovieProviderSearchDeferredV4(deferred, progress.checkpoint());
    const next = providerIds.filter((id) => !progress.exhausted.has(id));
    if (next.length > 0) {
      progress.nextRound();
      throw new MovieProviderSearchDeferredV4(
        await nextMovieSearchAdmission(context, next),
        progress.checkpoint(),
      );
    }
  }
  const { candidates, earliest } = progress.results(
    context.now?.().getTime() ?? Date.now(),
  );
  if (Number.isFinite(earliest))
    await queueMovieSearchDelay(context, scope, {
      profile: target.profile,
      generation: continuation?.generation,
      eligibleAt: new Date(earliest),
    });
  if (
    continuation === undefined &&
    deferred !== undefined &&
    candidates.length === 0
  )
    throw new MovieProviderSearchDeferredV4(deferred, progress.checkpoint());
  return candidates;
}

type SearchPass = {
  providerIds: ProviderCandidate["providerId"][];
  scope: MovieEditionScope;
  access: MovieChoiceAccess;
  query: ProviderSearch;
  rejected: ReadonlySet<string>;
  progress: MovieCandidateSearchProgress;
  paged: boolean;
};

async function collectMovieProviderPass(
  context: ReturnType<typeof movieManagementContext>,
  pass: SearchPass,
) {
  const { providerIds, progress } = pass;
  const pending = providerIds.filter(
    (providerId) =>
      !progress.completed.has(providerId) &&
      !progress.exhausted.has(providerId),
  );
  let deferred: ProviderAdmissionDeferred | undefined;
  for (const providerId of pending) {
    if (progress.atLimit) break;
    try {
      const page = await readMovieProviderPage(context, providerId, pass);
      await progress.recordPage(providerId, page, context.cipher, (source) =>
        assessMovieProviderListing(context, pass, source),
      );
    } catch (error) {
      if (error instanceof ProviderAdmissionDeferred) {
        if (error.retryAt.getTime() < (deferred?.retryAt.getTime() ?? Infinity))
          deferred = error;
      } else if (error instanceof IntegrationError) {
        // A terminal remote result settles this provider for this search pass;
        // another provider's local wait must not manufacture remote retries.
        progress.settle(providerId);
      } else throw error;
    }
  }
  return deferred;
}

async function assessMovieProviderListing(
  context: MediaAutomationContext,
  { scope, rejected }: SearchPass,
  source: ProviderCandidate,
) {
  if (rejected.has(source.infoHash.toLowerCase())) return null;
  context.plexBindingExecution().assertActive();
  const admission = await listMovieCandidateV4(context, scope, source);
  if (
    admission === null ||
    (!admission.accepted && admission.eligibleAt === null)
  )
    return null;
  return {
    candidate: admission.candidate,
    ...(admission.eligibleAt === null
      ? {}
      : { eligibleAt: admission.eligibleAt }),
  };
}

async function readMovieProviderPage(
  context: ReturnType<typeof movieManagementContext>,
  providerId: ProviderCandidate["providerId"],
  { scope, access, query, paged, progress }: SearchPass,
) {
  const page = await context.providers.withProvider(
    providerId,
    async (client) => {
      const sponsor = await requireMovieAcquisitionAuthorityV4(
        context.db,
        scope,
        access,
        context.movieManagement,
      );
      sponsor.freshness.assertActive();
      if (paged && client.searchPage !== undefined)
        return client.searchPage({ ...query, page: progress.round });
      if (progress.round !== 1)
        throw new Error("Movie provider lost its search paging capability");
      const candidates = await client.search(query);
      return {
        candidates,
        listingIds: candidates.map(
          ({ providerReleaseId }) => providerReleaseId,
        ),
        nextPage: null,
      };
    },
    paged ? { deferLocalPacing: true } : undefined,
  );
  if (page.candidates.length > 100 || page.listingIds.length > 100)
    throw new MediaError(
      "movie_candidate_limit",
      "Provider search exceeded its candidate bound",
      422,
    );
  return page;
}

/** Start the next pass at the earliest persisted provider pacing deadline. */
async function nextMovieSearchAdmission(
  context: MediaAutomationContext,
  providerIds: string[],
) {
  const leases = await context.db.providerLease.findMany({
    where: { providerId: { in: providerIds } },
    select: { providerId: true, nextAllowedAt: true },
  });
  const deadlines = new Map(
    leases.map(({ providerId, nextAllowedAt }) => [
      providerId,
      nextAllowedAt.getTime(),
    ]),
  );
  const now = Date.now();
  const retryAt = new Date(
    Math.min(
      ...providerIds.map((providerId) => deadlines.get(providerId) ?? now),
    ),
  );
  return new ProviderAdmissionDeferred("movie-search", retryAt, "cooldown");
}
