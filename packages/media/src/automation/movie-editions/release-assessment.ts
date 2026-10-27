import type { MediaAutomationContext } from "#automation/context.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import { serializable } from "#automation/store.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { matchMovieReleaseV4 } from "#domain/editions/release-v4.ts";
import {
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { referenceConflict } from "#infrastructure/acquisition-identity/evaluation.ts";
import { cutCanonical } from "#infrastructure/editions/cut-context.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  providerMovieCutV2,
  retainedMovieCutV2,
} from "#infrastructure/movie-editions/cut-v2.ts";
import {
  appendMovieAssessment,
  movieAssessmentContext,
} from "#infrastructure/movie-editions/release-assessment.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { MovieReleaseAssessmentSchema } from "#shared/movie-editions/release-assessment.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { collectResolvedEvidence } from "#migration/runtime-evidence.ts";
import { prepareResolvedMovieEvidenceV4 } from "#migration/movie-evidence/prepare.ts";
import { MediaError } from "#application/errors.ts";

/** Reparse the actual retained source, never the old title interpretation or query's coverage. */
export async function prepareMovieAssessment(
  context: MediaAutomationContext,
  input: {
    releaseId: string;
    scope: MovieEditionScope;
    observedSource?: ProviderCandidate;
  },
) {
  const current = await movieAssessmentContext(context.db, input.scope);
  const release = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  if (release.encryptedSource === null || release.sourceEvidence === null)
    throw new MediaError(
      "identity_source_missing",
      "Movie assessment requires its retained provider source",
      409,
    );
  const source = StoredCandidateSchema.parse(
    JSON.parse(
      context.cipher.decrypt(
        release.encryptedSource,
        `release:${release.providerId}:${release.providerReleaseId}`,
      ),
    ),
  );
  if (
    source.providerId !== release.providerId ||
    source.providerReleaseId !== release.providerReleaseId ||
    source.title !== release.title ||
    source.sizeBytes !==
      PublicReleaseAttributesSchema.parse(release.attributes).sizeBytes ||
    (input.observedSource !== undefined &&
      candidateSourceIdentity(source) !==
        candidateSourceIdentity(input.observedSource))
  )
    throw new MediaError(
      "identity_source_changed",
      "Observed provider source differs from its retained snapshot",
      409,
    );
  const cutIdentity = await cutCanonical(context.db, [input.scope.mediaId]);
  const cut = providerMovieCutV2(release.id, source, cutIdentity);
  if (
    identityHash(cut) !== identityHash(retainedMovieCutV2(release, cutIdentity))
  )
    throw new MediaError(
      "identity_source_changed",
      "Encrypted provider source differs from its retained public evidence",
      409,
    );
  const catalog = canonicalReferences(current.media);
  const attributes = matchMovieReleaseV4(
    {
      id: release.id,
      providerId: source.providerId,
      title: source.title,
      sizeBytes: source.sizeBytes,
      media: {
        id: current.media.id,
        kind: "movie",
        title: current.media.title,
        year: current.media.year,
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
  if (referenceConflict(current.media, source.references ?? []))
    attributes.identityConfidence = "mismatch";
  if (current.rules.resolved !== undefined) {
    attributes.resolvedEvidence = await collectResolvedEvidence(
      current.rules.resolved,
      prepareResolvedMovieEvidenceV4(
        current.rules.resolved,
        {
          id: release.id,
          title: source.title,
          identityConfirmed: attributes.identityConfidence === "exact",
          sizeBytes: source.sizeBytes,
          runtimeMinutes: current.runtimeMinutes,
          originalLanguage: current.originalLanguage,
          audioLanguages:
            attributes.audioLanguages.length === 0
              ? null
              : [...attributes.audioLanguages],
          specialEpisode: false,
        },
        cut,
      ),
    );
  }
  return MovieReleaseAssessmentSchema.parse({
    schemaVersion: 1,
    parserVersion: "movie-release-v4",
    releaseId: release.id,
    scope: current.scope,
    sourceHash: candidateDigest(release),
    canonicalHash: current.canonicalHash,
    canonical: current.canonical,
    runtimeMinutes: current.runtimeMinutes,
    originalLanguage: current.originalLanguage,
    profile: current.profile,
    attributes: PublicReleaseAttributesSchema.parse(attributes),
    cut,
  });
}

export async function assessRetainedMovieRelease(
  context: MediaAutomationContext,
  input: Parameters<typeof prepareMovieAssessment>[1],
) {
  const value = await prepareMovieAssessment(context, input);
  return serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, value.scope);
    return appendMovieAssessment(tx, value);
  });
}
