import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import {
  ProviderAdmissionDeferred,
  ProviderIdSchema,
} from "#automation/providers.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { movieAssessmentContext } from "#infrastructure/movie-editions/release-assessment.ts";
import { rejectedMovieSourceHashesV1 } from "#infrastructure/movie-editions/rollback/rejected-sources.ts";
import { isProgressiveQualityProfile } from "#domain/progressive-quality.ts";
import {
  collectProviderSearchRound,
  includeFeedObservation,
  providerSearchTransition,
} from "#automation/provider-search/progress.ts";
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
  feedSourceId?: string,
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
    ...(feedSourceId === undefined ? {} : { feedSourceId }),
    canonicalHash: target.canonicalHash,
    profile: target.profile,
    rejected: [...rejected].sort(),
    providers: providers.map((provider) => ({
      id: provider.id,
      configuration: provider.configuration,
      credentialId: provider.credentialId,
    })),
  });
  const now = () => context.now?.().getTime() ?? Date.now();
  const progressive = isProgressiveQualityProfile(target.rules);
  const progress = new MovieCandidateSearchProgress(
    criteriaDigest,
    continuation?.providerSearchProgress,
    progressive ? now() : undefined,
  );
  const providerIds = providers.map(({ id }) => ProviderIdSchema.parse(id));
  const pass: SearchPass = {
    scope,
    access,
    query,
    rejected,
    paged: continuation !== undefined,
  };
  const search = {
    providers: providerIds,
    cipher: context.cipher,
    now,
    assess: (source: ProviderCandidate) =>
      assessMovieProviderListing(context, pass, source),
  };
  await includeFeedObservation(progress, {
    ...search,
    db: context.db,
    feedSourceId,
  });
  const deferred = await collectProviderSearchRound({
    ...search,
    progress,
    readPage: (providerId, round) =>
      readMovieProviderPage(context, providerId, pass, round),
  });
  const result =
    continuation === undefined
      ? { state: "selecting" as const, ...progress.results(now()) }
      : await providerSearchTransition(progress, {
          db: context.db,
          providers: providerIds,
          deferred,
          now: now(),
        });
  if (result.state === "waiting-for-provider")
    throw new MovieProviderSearchDeferredV4(
      new ProviderAdmissionDeferred(
        deferred?.service ?? "movie-search",
        new Date(result.retryAt),
        deferred?.admission ?? "cooldown",
      ),
      progress.checkpoint(),
    );
  const { candidates, earliest } = result;
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
  scope: MovieEditionScope;
  access: MovieChoiceAccess;
  query: ProviderSearch;
  rejected: ReadonlySet<string>;
  paged: boolean;
};

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
  { scope, access, query, paged }: SearchPass,
  round: number,
) {
  return context.providers.withProvider(
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
        return client.searchPage({ ...query, page: round });
      if (round !== 1)
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
}
