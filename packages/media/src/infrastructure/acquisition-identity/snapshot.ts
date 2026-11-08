import { z } from "zod";
import type {
  MediaItem,
  Prisma,
  ReleaseCandidate,
} from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { EpisodeNumberingSchema } from "#shared/numbering.ts";
import {
  NumberingProvenanceSchema,
  CoordinateSnapshotSchema,
} from "#shared/acquisition/coordinates.ts";
import {
  CandidateSourceEvidenceSchema,
  CanonicalIdentitySchema,
  type CanonicalIdentity,
} from "#shared/acquisition/identity.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";

export function identityHash(value: unknown): string {
  return snapshotHash(z.json().parse(value));
}

export function candidateDigest(row: ReleaseCandidate): string {
  const evidence = CandidateSourceEvidenceSchema.parse(row.sourceEvidence);
  return identityHash({
    providerId: row.providerId,
    providerReleaseId: row.providerReleaseId,
    title: row.title,
    attributes: row.attributes,
    source: evidence,
  });
}

export function numberingOf(row: MediaItem) {
  const numbering = EpisodeNumberingSchema.parse(row.externalIds);
  const extra = z
    .object({ numberingProvenance: NumberingProvenanceSchema.optional() })
    .parse(row.externalIds);
  if (
    numbering.absoluteNumber !== undefined &&
    extra.numberingProvenance === undefined &&
    numbering.numberingEvidence === undefined
  )
    throw new MediaError(
      "numbering_provenance_missing",
      "Reaffirm this historical absolute mapping before acquisition",
      409,
    );
  return {
    absoluteNumber: numbering.absoluteNumber ?? null,
    numberingProvenance:
      extra.numberingProvenance ??
      (numbering.absoluteNumber === undefined
        ? { kind: "canonical" as const }
        : {
            kind: "legacy_owner" as const,
            version: row.version,
            evidence: z.string().parse(numbering.numberingEvidence),
          }),
  };
}

/** Stable metadata only: request/availability versions must not invalidate an acquired identity. */
function stableNumbering(row: MediaItem) {
  const value = numberingOf(row);
  return {
    ...value,
    numberingProvenance:
      value.numberingProvenance.kind === "legacy_owner"
        ? { kind: "legacy_owner", evidence: value.numberingProvenance.evidence }
        : value.numberingProvenance,
  };
}
export function fullSeriesNumberingDigest(
  series: MediaItem,
  episodes: readonly MediaItem[],
): string {
  const catalog = z
    .object({ catalogIdentity: CatalogIdentitySchema.optional() })
    .parse(series.externalIds);
  return identityHash({
    series: {
      id: series.id,
      tmdbId: series.tmdbId,
      title: series.title,
      year: series.year,
      catalogState: series.catalogState,
      catalogIdentity: catalog.catalogIdentity ?? null,
      references: canonicalReferences(series).references,
    },
    episodes: [...episodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({
        id: row.id,
        parentId: row.parentId,
        tmdbId: row.tmdbId,
        season: row.seasonNumber,
        episode: row.episodeNumber,
        catalogState: row.catalogState,
        ...stableNumbering(row),
      })),
  });
}

export async function buildCanonicalIdentity(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<CanonicalIdentity> {
  if (
    mediaIds.length === 0 ||
    mediaIds.length > 100 ||
    new Set(mediaIds).size !== mediaIds.length
  )
    throw new MediaError(
      "identity_coverage_invalid",
      "Select up to 100 distinct canonical leaves",
      422,
    );
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: [...mediaIds] } },
    include: { parent: { include: { parent: true } } },
    orderBy: { id: "asc" },
  });
  if (rows.length !== mediaIds.length)
    throw new MediaError(
      "identity_coverage_changed",
      "Canonical coverage changed",
      409,
    );
  const first = rows[0];
  if (first === undefined) throw new Error("Identity coverage absent");
  if (first.kind === "movie" && rows.length === 1)
    return CanonicalIdentitySchema.parse({
      kind: "movie",
      mediaId: first.id,
      mediaVersion: first.version,
      catalogDigest: identityHash({
        references: canonicalReferences(first).references,
        id: first.id,
        kind: first.kind,
        tmdbId: first.tmdbId,
        title: first.title,
        year: first.year,
        catalogIdentity:
          z
            .object({ catalogIdentity: CatalogIdentitySchema.optional() })
            .parse(first.externalIds).catalogIdentity ?? null,
      }),
    });
  const series =
    first.parent?.kind === "series" ? first.parent : first.parent?.parent;
  if (
    series?.kind !== "series" ||
    series.catalogState !== "ready" ||
    rows.some(
      (row) =>
        row.kind !== "episode" ||
        (row.parent?.kind === "series"
          ? row.parent.id
          : row.parent?.parentId) !== series.id,
    )
  )
    throw new MediaError(
      "identity_series_invalid",
      "Select episodes from one complete canonical series",
      409,
    );
  const episodes = await tx.mediaItem.findMany({
    where: {
      kind: "episode",
      OR: [{ parentId: series.id }, { parent: { parentId: series.id } }],
    },
    orderBy: { id: "asc" },
    take: 10_001,
  });
  if (
    episodes.length > 10_000 ||
    episodes.some((row) => row.catalogState !== "ready")
  )
    throw new MediaError(
      "identity_catalog_incomplete",
      "Canonical episode catalog is incomplete or too large",
      409,
    );
  const absolute = episodes.flatMap((row) => {
    const number = numberingOf(row).absoluteNumber;
    return number === null ? [] : [number];
  });
  const coordinates = episodes.map(
    (row) => `${String(row.seasonNumber)}:${String(row.episodeNumber)}`,
  );
  if (
    new Set(absolute).size !== absolute.length ||
    new Set(coordinates).size !== coordinates.length
  )
    throw new MediaError(
      "identity_numbering_conflict",
      "Canonical episode numbers are not unique",
      409,
    );
  const snapshot = {
    schemaVersion: 1 as const,
    seriesId: series.id,
    seriesVersion: series.version,
    catalogComplete: true as const,
    fullSeriesNumberingDigest: fullSeriesNumberingDigest(series, episodes),
    episodes: rows.map((row) => ({
      mediaId: row.id,
      mediaVersion: row.version,
      seriesId: series.id,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      tmdbEpisodeId: row.tmdbId,
      ...numberingOf(row),
    })),
  };
  return {
    kind: "series",
    coordinates: CoordinateSnapshotSchema.parse({
      ...snapshot,
      digest: identityHash(snapshot),
    }),
  };
}

export function canonicalSemantics(value: CanonicalIdentity): unknown {
  return value.kind === "movie"
    ? {
        kind: value.kind,
        mediaId: value.mediaId,
        catalogDigest: value.catalogDigest,
      }
    : {
        kind: value.kind,
        seriesId: value.coordinates.seriesId,
        fullSeriesNumberingDigest: value.coordinates.fullSeriesNumberingDigest,
        mediaIds: value.coordinates.episodes.map((row) => row.mediaId).sort(),
      };
}
import { canonicalReferences } from "./references.ts";
