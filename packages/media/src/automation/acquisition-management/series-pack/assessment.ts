import type { MediaAutomationContext } from "#automation/context.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { serializable } from "#automation/store.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { referenceConflict } from "#infrastructure/acquisition-identity/evaluation.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  seriesPackCatalogV1,
  seriesPackChanged,
} from "#infrastructure/acquisition-identity/series-pack/catalog.ts";
import { appendSeriesPackInterpretationV1 } from "#infrastructure/acquisition-identity/series-pack/append.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import { matchSeriesPackReleaseV1 } from "#domain/acquisition-identity/series-pack-matcher.ts";
import { SeriesPackInterpretationV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { collectResolvedEvidence } from "#migration/runtime-evidence.ts";
import { prepareSeriesPackResolvedEvidenceV1 } from "#migration/series-pack-evidence.ts";

/** A real current assessment of retained bytes creates no requester, ownership or historical acquisition. */
export async function assessSeriesPackV1(
  context: MediaAutomationContext,
  input: {
    releaseId: string;
    primaryMediaId: string;
    observedSource?: ProviderCandidate;
  },
) {
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw seriesPackChanged(
      "A pack assessment needs its original Activity allowance and execution",
    );
  invocation.freshness.assertActive();
  const release = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  invocation.budget.consume(1);
  if (release.encryptedSource === null || release.sourceEvidence === null)
    throw seriesPackChanged(
      "Pack interpretation requires actual retained provider bytes",
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
    throw seriesPackChanged(
      "Observed pack source differs from its original retained bytes",
    );
  const parsed = parseSeriesSeasonSetV1(source.title);
  if (parsed.status !== "resolved")
    throw seriesPackChanged(
      "The source has no one explicit bounded season range",
    );
  const current = await seriesPackCatalogV1(
    context.db,
    { primaryMediaId: input.primaryMediaId, range: parsed.range },
    invocation.budget,
  );
  const catalog = canonicalReferences(current.root);
  const matched = matchSeriesPackReleaseV1(
    {
      id: release.id,
      providerId: release.providerId,
      title: source.title,
      sizeBytes: source.sizeBytes,
      media: {
        id: current.primary.id,
        kind: "episode",
        title: current.primary.title,
        year: current.primary.year,
        seriesTitle: current.root.title,
        ...(current.root.year === null
          ? {}
          : { seriesYear: current.root.year }),
        aliases: catalog.aliases,
        externalIds: Object.fromEntries(
          catalog.references.map((ref) => [ref.namespace, ref.value]),
        ),
      },
      externalIds: Object.fromEntries(
        (source.references ?? []).map((ref) => [ref.namespace, ref.value]),
      ),
      knownEpisodes: current.canonical.coordinates.episodes.map((episode) => ({
        mediaId: episode.mediaId,
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
      })),
    },
    current.canonical.coordinates,
  );
  if (
    matched.status !== "resolved" ||
    matched.attributes.identityConfidence !== "exact" ||
    referenceConflict(current.root, source.references ?? [])
  )
    throw seriesPackChanged(
      "Whole-pack identity is not exact under current canonical facts",
    );
  const attributes = matched.attributes;
  if (current.rules.resolved !== undefined)
    attributes.resolvedEvidence = await collectResolvedEvidence(
      current.rules.resolved,
      prepareSeriesPackResolvedEvidenceV1(
        current.rules.resolved,
        {
          id: release.id,
          title: source.title,
          identityConfirmed: true,
          sizeBytes: source.sizeBytes,
          runtimeMinutes: current.runtimeMinutes,
          originalLanguage: current.originalLanguage,
          audioLanguages:
            attributes.audioLanguages.length === 0
              ? null
              : [...attributes.audioLanguages],
          specialEpisode: false,
        },
        parsed.range,
      ),
    );
  invocation.freshness.assertActive();
  const value = SeriesPackInterpretationV1Schema.parse({
    schemaVersion: 1,
    parserVersion: "series-season-range-v1",
    releaseId: release.id,
    sourceHash: candidateDigest(release),
    seriesId: current.root.id,
    canonicalHash: current.canonicalHash,
    canonical: current.canonical,
    range: parsed.range,
    profile: current.profile,
    runtimeMinutes: current.runtimeMinutes,
    originalLanguage: current.originalLanguage,
    attributes: PublicReleaseAttributesSchema.parse(attributes),
  });
  return serializable(context.db, (tx) =>
    appendSeriesPackInterpretationV1(
      tx,
      { value, primaryMediaId: input.primaryMediaId },
      invocation,
    ),
  );
}
