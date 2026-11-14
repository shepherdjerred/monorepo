import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import {
  ProviderAdmissionDeferred,
  ProviderIdSchema,
} from "#automation/providers.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import {
  movieAssessmentContext,
  assertCurrentMovieAssessment,
} from "#infrastructure/movie-editions/release-assessment.ts";
import {
  providerMovieCutV2,
  assessMovieCutV2,
} from "#infrastructure/movie-editions/cut-v2.ts";
import { cutCanonical } from "#infrastructure/editions/cut-context.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { referenceConflict } from "#infrastructure/acquisition-identity/evaluation.ts";
import { rejectedMovieSourceHashesV1 } from "#infrastructure/movie-editions/rollback/rejected-sources.ts";
import { matchMovieReleaseV4 } from "#domain/editions/release-v4.ts";
import { evaluateRelease, chooseUpgrade } from "#domain/quality.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { MovieReleaseAssessmentRef } from "#shared/movie-editions/release-assessment.ts";
import { assessRetainedMovieRelease } from "./release-assessment.ts";
import { requireMovieAcquisitionAuthorityV4 } from "./acquisition-authority.ts";
import { movieManagementContext } from "./management-context.ts";
import { movieCurrentQuality } from "./current-quality.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { providerCandidateAdmission } from "#automation/provider-selection.ts";
import { compareProviderCandidates } from "#domain/provider-selection.ts";
import type {
  MovieProviderSearchProgressV4,
  MovieReconcileOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";

export class MovieProviderSearchDeferredV4 extends ProviderAdmissionDeferred {
  constructor(
    deferred: ProviderAdmissionDeferred,
    readonly progress: MovieProviderSearchProgressV4,
  ) {
    super(deferred.service, deferred.retryAt, deferred.admission);
  }
}

function completedProviders(
  progress: MovieProviderSearchProgressV4 | undefined,
  criteriaDigest: string,
) {
  return new Set<string>(
    progress?.criteriaDigest === criteriaDigest
      ? progress.completedProviderIds
      : [],
  );
}

export type MovieCandidateV4 = {
  releaseId: string;
  assessment: MovieReleaseAssessmentRef;
  rank: number;
  score: number;
  priority: number;
};

/** Only measured properties of this edition can supply its current quality; another cut is not its predecessor. */
export async function currentMovieReleaseV4(
  tx: Prisma.TransactionClient,
  input: MovieEditionScope,
) {
  const scope = MovieEditionScopeSchema.parse(input);
  const coverage = await tx.assetCoverage.findFirst({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    include: { asset: true },
  });
  if (coverage === null) return null;
  if (
    coverage.asset.editionRootId !== scope.rootMediaId ||
    coverage.asset.edition !== scope.edition
  )
    throw new Error("Movie quality predecessor has another edition scope");
  const metadata = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
    select: { runtimeMinutes: true, originalLanguage: true },
  });
  return movieCurrentQuality(coverage.asset.properties, metadata);
}

export async function requireMovieSponsorV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  access: Parameters<typeof eligibleAcquisitionSponsors>[1]["access"],
  budget?: PublicationAuthorityReadBudget,
) {
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope,
    access,
    protocol: "movie-v4",
    ...(budget === undefined ? {} : { budget }),
  });
  const sponsor = sponsors[0];
  if (sponsor === undefined)
    throw new MovieChoiceProtection("movie_edition_choice_required");
  sponsor.freshness.assertActive();
  return sponsor;
}

async function retainSource(
  context: MediaAutomationContext,
  input: MovieEditionScope,
  source: ProviderCandidate,
  matchedOnly = false,
) {
  const existing = await context.db.releaseCandidate.findUnique({
    where: {
      providerId_providerReleaseId: {
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
      },
    },
  });
  if (existing !== null) return existing.id;
  const target = await movieAssessmentContext(context.db, input);
  const id = crypto.randomUUID();
  const catalog = canonicalReferences(target.media);
  const cut = providerMovieCutV2(
    id,
    source,
    await cutCanonical(context.db, [input.mediaId]),
  );
  const attributes = matchMovieReleaseV4(
    {
      id,
      providerId: source.providerId,
      title: source.title,
      sizeBytes: source.sizeBytes,
      media: {
        id: target.media.id,
        kind: "movie",
        title: target.media.title,
        year: target.media.year,
        aliases: catalog.aliases,
        externalIds: Object.fromEntries(
          catalog.references.map((ref) => [ref.namespace, ref.value]),
        ),
      },
      knownEpisodes: [],
      externalIds: Object.fromEntries(
        (source.references ?? []).map((ref) => [ref.namespace, ref.value]),
      ),
    },
    cut,
  ).attributes;
  if (referenceConflict(target.media, source.references ?? []))
    attributes.identityConfidence = "mismatch";
  if (
    matchedOnly &&
    (attributes.identityConfidence !== "exact" ||
      !attributes.mediaIds.includes(input.mediaId))
  )
    return null;
  const profile = {
    id: target.profile.id,
    version: target.profile.version,
    ...target.rules,
  };
  const evaluation = evaluateRelease(
    attributes,
    profile,
    [input.mediaId],
    "listing",
  );
  const stored = await persistCandidateSnapshot(context, {
    source,
    attributes,
    evaluation,
    searchedForMediaId: input.mediaId,
  });
  if (stored !== null) return stored.id;
  // A concurrent old/new parser may have retained this source first. Assess those literal bytes separately.
  const retained = await context.db.releaseCandidate.findUniqueOrThrow({
    where: {
      providerId_providerReleaseId: {
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
      },
    },
  });
  return retained.id;
}

export async function storeMovieCandidateV4(
  context: MediaAutomationContext,
  input: MovieEditionScope,
  source: ProviderCandidate,
  matchedOnly = false,
): Promise<MovieCandidateV4 | null> {
  const scope = MovieEditionScopeSchema.parse(input);
  const releaseId = await retainSource(context, scope, source, matchedOnly);
  if (releaseId === null) return null;
  const assessment = await assessRetainedMovieRelease(context, {
    scope,
    releaseId,
    observedSource: source,
  });
  const current = await assertCurrentMovieAssessment(
    context.db,
    assessment.ref,
    scope,
    releaseId,
  );
  const cut = await assessMovieCutV2(context.db, {
    scope,
    releaseId,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
  });
  if (!cut.decision.accepted) return null;
  const candidate = {
    id: releaseId,
    providerId: source.providerId,
    title: source.title,
    ...current.value.attributes,
  };
  const chosen = chooseUpgrade({
    phase: "listing",
    candidate,
    current: await currentMovieReleaseV4(context.db, scope),
    profile: {
      id: current.current.profile.id,
      version: current.current.profile.version,
      ...current.current.rules,
    },
    mediaIds: [scope.mediaId],
  });
  if (!chosen.upgrade) return null;
  const admission = await providerCandidateAdmission(context, {
    releaseId,
    mediaId: scope.mediaId,
    edition: scope.edition,
    rank: chosen.evaluation.qualityRank,
    profile: {
      id: current.current.profile.id,
      version: current.current.profile.version,
      ...current.current.rules,
    },
  });
  if (!admission.accepted) return null;
  return {
    releaseId,
    assessment: assessment.ref,
    rank: chosen.evaluation.qualityRank,
    score: chosen.evaluation.score,
    priority: admission.priority,
  };
}

async function assessProviderResults(
  context: MediaAutomationContext,
  scope: MovieEditionScope,
  providerId: string,
  input: { sources: ProviderCandidate[]; rejected: ReadonlySet<string> },
) {
  const { sources, rejected } = input;
  if (sources.length > 100)
    throw new MediaError(
      "movie_candidate_limit",
      "Provider search exceeded its candidate bound",
      422,
    );
  const accepted: MovieCandidateV4[] = [];
  for (const source of sources) {
    if (source.providerId !== providerId)
      throw new Error("Movie provider returned another provider's source");
    if (rejected.has(source.infoHash.toLowerCase())) continue;
    const selected = await storeMovieCandidateV4(context, scope, source);
    if (selected !== null) accepted.push(selected);
  }
  return accepted;
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
  const accepted: MovieCandidateV4[] = [];
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
  const completed = completedProviders(
    continuation?.providerSearchProgress,
    criteriaDigest,
  );
  let deferred: ProviderAdmissionDeferred | undefined;
  for (const provider of providers.filter((item) => !completed.has(item.id))) {
    try {
      const sources = await context.providers.withProvider(
        provider.id,
        async (client) => {
          const sponsor = await requireMovieAcquisitionAuthorityV4(
            context.db,
            scope,
            access,
            context.movieManagement,
          );
          sponsor.freshness.assertActive();
          return client.search(query);
        },
      );
      accepted.push(
        ...(await assessProviderResults(context, scope, provider.id, {
          sources,
          rejected,
        })),
      );
      completed.add(provider.id);
    } catch (error) {
      if (error instanceof ProviderAdmissionDeferred) {
        if (
          deferred === undefined ||
          error.retryAt.getTime() < deferred.retryAt.getTime()
        )
          deferred = error;
      } else if (error instanceof IntegrationError) {
        // A terminal remote result settles this provider for this search pass;
        // another provider's local wait must not manufacture remote retries.
        completed.add(provider.id);
      } else throw error;
    }
  }
  if (deferred !== undefined && accepted.length === 0)
    throw new MovieProviderSearchDeferredV4(deferred, {
      criteriaDigest,
      completedProviderIds: providers
        .filter((provider) => completed.has(provider.id))
        .map((provider) => ProviderIdSchema.parse(provider.id)),
    });
  return accepted.sort((left, right) =>
    compareProviderCandidates(
      { ...left, id: left.releaseId },
      { ...right, id: right.releaseId },
    ),
  );
}
