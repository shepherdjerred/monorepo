import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import type { CanonicalIdentity } from "#shared/acquisition/identity.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import type { CapturedSeriesPackV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";
import {
  identityHash,
  canonicalSemantics,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { referenceConflict } from "#infrastructure/acquisition-identity/evaluation.ts";
import { matchSeriesPackReleaseV1 } from "#domain/acquisition-identity/series-pack-matcher.ts";
import { seriesPackCatalogV1, seriesPackChanged } from "./catalog.ts";
import { loadSeriesPackInterpretationV1 } from "./parent.ts";

/** Consent/runtime/target locks remain the caller's existing gate; this independently proves the exact derived source. */
export async function assertSeriesPackAuthorityV1(
  tx: Prisma.TransactionClient,
  input: {
    captured: CapturedSeriesPackV1;
    release: ReleaseCandidate;
    canonical: CanonicalIdentity;
    mediaIds: readonly string[];
    primaryMediaId: string;
    historical?: boolean;
  },
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  const parent = await loadSeriesPackInterpretationV1(
    tx,
    input.captured,
    invocation.budget,
    input.release,
  );
  const value = parent.value;
  if (
    input.canonical.kind !== "series" ||
    identityHash([...input.mediaIds].sort()) !==
      identityHash(value.attributes.mediaIds) ||
    identityHash(canonicalSemantics(input.canonical)) !==
      identityHash(canonicalSemantics(value.canonical))
  )
    throw seriesPackChanged(
      "Derived source changed its complete canonical coverage",
    );
  if (input.historical === true) return parent;
  const current = await seriesPackCatalogV1(
    tx,
    { primaryMediaId: input.primaryMediaId, range: value.range },
    invocation.budget,
  );
  if (
    current.canonicalHash !== value.canonicalHash ||
    identityHash(current.profile) !== identityHash(value.profile)
  )
    throw seriesPackChanged(
      "Actual complete season coverage, runtime evidence or quality profile changed",
    );
  const source = CandidateSourceEvidenceSchema.parse(
    input.release.sourceEvidence,
  );
  const catalog = canonicalReferences(current.root);
  const matched = matchSeriesPackReleaseV1(
    {
      id: input.release.id,
      providerId: input.release.providerId,
      title: input.release.title,
      sizeBytes: value.attributes.sizeBytes,
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
    identityHash(matched.range) !== identityHash(value.range) ||
    identityHash(matched.attributes.mediaIds) !==
      identityHash(value.attributes.mediaIds) ||
    referenceConflict(current.root, source.references ?? [])
  )
    throw seriesPackChanged(
      "The original source no longer proves its exact whole-season identity",
    );
  invocation.freshness.assertActive();
  return parent;
}
