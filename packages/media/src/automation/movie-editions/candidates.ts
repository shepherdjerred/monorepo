import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  persistCandidateSnapshot,
  refreshRetainedAvailability,
} from "#automation/candidate-evidence.ts";
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
import { matchMovieReleaseV4 } from "#domain/editions/release-v4.ts";
import { evaluateRelease, chooseUpgrade } from "#domain/quality.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { MovieReleaseAssessmentRef } from "#shared/movie-editions/release-assessment.ts";
import {
  assessRetainedMovieRelease,
  ObservedMovieSourceChanged,
} from "./release-assessment.ts";
import { movieCurrentQuality } from "./current-quality.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  providerCandidateAdmission,
  readProviderCandidateAdmission,
} from "#automation/provider-selection.ts";

export type MovieCandidateV4 = {
  releaseId: string;
  assessment: MovieReleaseAssessmentRef;
  rank: number;
  score: number;
  priority: number;
  seeders?: number | null | undefined;
  fallbackDistanceBytes?: number | undefined;
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

async function rankMovieCandidateV4(
  context: MediaAutomationContext,
  input: MovieEditionScope,
  source: ProviderCandidate,
  matchedOnly = false,
) {
  const scope = MovieEditionScopeSchema.parse(input);
  const releaseId = await retainSource(context, scope, source, matchedOnly);
  if (releaseId === null) return null;
  const assessment = await assessRetainedMovieRelease(context, {
    scope,
    releaseId,
    observedSource: source,
  });
  if (!(await refreshRetainedAvailability(context, releaseId, source)))
    return null;
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
  const profile = {
    id: current.current.profile.id,
    version: current.current.profile.version,
    ...current.current.rules,
  };
  const chosen = chooseUpgrade({
    phase: "listing",
    candidate,
    current: await currentMovieReleaseV4(context.db, scope),
    profile,
    mediaIds: [scope.mediaId],
  });
  return chosen.upgrade
    ? {
        profile,
        releaseId,
        assessment: assessment.ref,
        rank: chosen.evaluation.qualityRank,
        score: chosen.evaluation.score,
        seeders: source.seeders,
        ...(chosen.evaluation.fallbackDistanceBytes === undefined
          ? {}
          : { fallbackDistanceBytes: chosen.evaluation.fallbackDistanceBytes }),
      }
    : null;
}

export async function storeMovieCandidateV4(
  context: MediaAutomationContext,
  scope: MovieEditionScope,
  source: ProviderCandidate,
  matchedOnly = false,
): Promise<MovieCandidateV4 | null> {
  const ranked = await rankMovieCandidateV4(
    context,
    scope,
    source,
    matchedOnly,
  );
  if (ranked === null) return null;
  const { profile, ...candidate } = ranked;
  const admission = await providerCandidateAdmission(context, {
    releaseId: candidate.releaseId,
    mediaId: scope.mediaId,
    edition: scope.edition,
    rank: candidate.rank,
    profile,
  });
  return admission.accepted
    ? { ...candidate, priority: admission.priority }
    : null;
}

export async function listMovieCandidateV4(
  context: MediaAutomationContext,
  scope: MovieEditionScope,
  source: ProviderCandidate,
) {
  let ranked: Awaited<ReturnType<typeof rankMovieCandidateV4>>;
  try {
    ranked = await rankMovieCandidateV4(context, scope, source);
  } catch (error) {
    if (error instanceof ObservedMovieSourceChanged) return null;
    throw error;
  }
  if (ranked === null) return null;
  const { profile, ...candidate } = ranked;
  const admission = await readProviderCandidateAdmission(context, {
    releaseId: candidate.releaseId,
    mediaId: scope.mediaId,
    edition: scope.edition,
    rank: candidate.rank,
    profile,
  });
  return {
    ...admission,
    candidate: { ...candidate, priority: admission.priority },
  };
}
