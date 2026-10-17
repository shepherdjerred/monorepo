import type {
  MediaItem,
  Prisma,
  ReleaseCandidate,
} from "#generated/prisma/client.ts";
import { type ProviderReference } from "#shared/acquisition/catalog.ts";
import type {
  AcquisitionIdentitySnapshot,
  CanonicalIdentity,
} from "#shared/acquisition/identity.ts";
import { parseEpisodeCoordinates } from "#domain/acquisition-identity/parser.ts";
import { resolveEpisodeCoordinates } from "#domain/acquisition-identity/coordinates.ts";
import { identityHash } from "./snapshot.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { CatalogReferenceSchema } from "#shared/acquisition/catalog.ts";
import { MediaError } from "#application/errors.ts";
import {
  PublicReleaseAttributesSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import { effectiveCandidate } from "#domain/acquisition-identity/effective.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { canonicalReferences } from "./references.ts";

export function referenceConflict(
  root: MediaItem,
  references: readonly ProviderReference[],
): boolean {
  const expected = canonicalReferences(root).references;
  return references.some(
    (reference) =>
      reference.kind !== root.kind ||
      references.some(
        (other) =>
          other.namespace === reference.namespace &&
          other.value !== reference.value,
      ) ||
      expected.some(
        (target) =>
          target.kind === reference.kind &&
          target.namespace === reference.namespace &&
          target.value !== reference.value,
      ),
  );
}

export function sourceIdentityProof(
  root: MediaItem,
  release: ReleaseCandidate,
) {
  const references =
    CandidateSourceEvidenceSchema.parse(release.sourceEvidence).references ??
    [];
  if (referenceConflict(root, references))
    throw new MediaError(
      "external_identity_conflict",
      "Release identifiers conflict with canonical identity",
      409,
    );
  const catalog = canonicalReferences(root);
  const strong = references.filter(
    (reference) =>
      (reference.namespace === "tmdb" &&
        reference.value === String(root.tmdbId)) ||
      catalog.references.some(
        (target) =>
          target.kind === reference.kind &&
          target.namespace === reference.namespace &&
          target.value === reference.value,
      ),
  );
  return {
    basis:
      strong.length > 0
        ? ("strong_reference" as const)
        : ("title_year" as const),
    references: strong.map((reference) =>
      CatalogReferenceSchema.parse({
        kind: reference.kind,
        namespace: reference.namespace,
        value: reference.value,
      }),
    ),
  };
}

export async function coordinateBlockers(
  tx: Prisma.TransactionClient,
  canonical: CanonicalIdentity,
  title: string,
  ids: string[],
): Promise<string[]> {
  const parsed = parseEpisodeCoordinates(title);
  if (canonical.kind === "movie")
    return parsed.forms.some((form) => form.kind !== "unknown")
      ? ["movie_contains_episode_numbering"]
      : [];
  const reasons: string[] = [];
  const coverage = resolveEpisodeCoordinates(parsed, canonical.coordinates);
  if (coverage.status === "protected") reasons.push(coverage.reason);
  else if (
    identityHash([...coverage.mediaIds].sort()) !==
    identityHash([...ids].sort())
  )
    reasons.push("coordinate_selection_mismatch");
  for (const form of parsed.forms) {
    if (form.kind !== "season_pack") continue;
    const rootId = canonical.coordinates.seriesId;
    const season = await tx.mediaItem.findMany({
      where: {
        kind: "episode",
        seasonNumber: form.season,
        OR: [{ parentId: rootId }, { parent: { parentId: rootId } }],
      },
      select: { id: true },
      take: 101,
    });
    if (
      identityHash(season.map((row) => row.id).sort()) !==
      identityHash([...ids].sort())
    )
      reasons.push("season_pack_incomplete");
  }
  return reasons;
}

type ProfileMedia = Prisma.MediaItemGetPayload<{
  include: { intent: { include: { profile: true } } };
}>;
export function previewQuality(
  rows: ProfileMedia[],
  primaryId: string,
  release: ReleaseCandidate,
  proposed: AcquisitionIdentitySnapshot,
): Set<string> {
  const primary = rows.find((row) => row.id === primaryId);
  const projected = effectiveCandidate(
    {
      id: release.id,
      title: release.title,
      providerId: release.providerId,
      ...PublicReleaseAttributesSchema.parse(release.attributes),
    },
    proposed,
  );
  const blockers = new Set<string>();
  for (const row of rows) {
    const profile = row.intent?.profile ?? primary?.intent?.profile;
    if (profile === null || profile === undefined) {
      blockers.add("quality_profile_missing");
      continue;
    }
    const evaluation = evaluateRelease(
      projected,
      {
        id: profile.id,
        version: profile.version,
        ...QualityRulesSchema.parse(profile.rules),
      },
      [row.id],
    );
    if (!evaluation.accepted)
      for (const reason of evaluation.reasons) blockers.add(reason);
    if (row.intent?.intentionallyRemovedAt != null)
      blockers.add("intentionally_removed");
  }
  return blockers;
}
