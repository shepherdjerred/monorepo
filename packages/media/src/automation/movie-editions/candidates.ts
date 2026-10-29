import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { ProviderIdSchema } from "#automation/providers.ts";
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

export type MovieCandidateV4 = {
  releaseId: string;
  assessment: MovieReleaseAssessmentRef;
  rank: number;
  score: number;
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
) {
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope,
    access,
    protocol: "movie-v4",
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
  const evaluation = evaluateRelease(attributes, profile, [input.mediaId]);
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
    candidate,
    current: await currentMovieReleaseV4(context.db, scope),
    profile: {
      id: current.current.profile.id,
      version: current.current.profile.version,
      ...current.current.rules,
    },
    mediaIds: [scope.mediaId],
  });
  return chosen.upgrade
    ? {
        releaseId,
        assessment: assessment.ref,
        rank: chosen.evaluation.qualityRank,
        score: chosen.evaluation.score,
      }
    : null;
}

async function assessProviderResults(
  context: MediaAutomationContext,
  scope: MovieEditionScope,
  providerId: string,
  sources: ProviderCandidate[],
) {
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
    const selected = await storeMovieCandidateV4(context, scope, source);
    if (selected !== null) accepted.push(selected);
  }
  return accepted;
}

export async function searchMovieCandidatesV4(
  initial: MediaAutomationContext,
  input: MovieEditionScope,
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
  const accepted: MovieCandidateV4[] = [];
  for (const provider of providers) {
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
          return client.search({
            query: target.media.title,
            kind: "movie",
            page: 1,
          });
        },
      );
      accepted.push(
        ...(await assessProviderResults(context, scope, provider.id, sources)),
      );
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
    }
  }
  return accepted.sort(
    (left, right) =>
      right.rank - left.rank ||
      right.score - left.score ||
      left.releaseId.localeCompare(right.releaseId),
  );
}
