import { z } from "zod";
import type { TmdbClient } from "#integrations/tmdb.ts";
import {
  CatalogIdentitySchema,
  type CatalogIdentity,
  type CatalogReference,
} from "#shared/acquisition/catalog.ts";
import { snapshotHash } from "#migration/profile-import.ts";

function buildCatalogIdentity(input: {
  kind: "movie" | "series";
  tmdbId: number;
  originalTitle: string;
  imdbId: string | null;
  tvdbId?: number | null;
  titles: Awaited<ReturnType<TmdbClient["alternativeTitles"]>>["titles"];
}) {
  const references: CatalogReference[] = [
    { kind: input.kind, namespace: "tmdb", value: String(input.tmdbId) },
  ];
  if (input.imdbId !== null)
    references.push({
      kind: input.kind,
      namespace: "imdb",
      value: z
        .string()
        .regex(/^tt\d+$/u)
        .parse(input.imdbId),
    });
  if (input.tvdbId !== undefined && input.tvdbId !== null)
    references.push({
      kind: input.kind,
      namespace: "tvdb",
      value: String(input.tvdbId),
    });
  const aliases = [
    ...new Map(
      input.titles.map((title) => [
        snapshotHash(title),
        { ...title, source: "tmdb" as const },
      ]),
    ).values(),
  ].sort((a, b) => snapshotHash(a).localeCompare(snapshotHash(b)));
  const snapshot = {
    schemaVersion: 1 as const,
    references,
    originalTitle: input.originalTitle,
    aliases,
  };
  return CatalogIdentitySchema.parse({
    ...snapshot,
    evidenceDigest: snapshotHash(snapshot),
  });
}

export async function loadMovieCatalogIdentity(tmdb: TmdbClient, id: number) {
  const [details, aliases] = await Promise.all([
    tmdb.movie(id),
    tmdb.alternativeTitles("movie", id),
  ]);
  if (details.id !== id) throw new Error("Catalog movie identity changed");
  return {
    details,
    identity: buildCatalogIdentity({
      kind: "movie",
      tmdbId: id,
      originalTitle: details.original_title,
      imdbId: details.imdb_id,
      titles: aliases.titles,
    }),
  };
}

export async function loadSeriesCatalogIdentity(tmdb: TmdbClient, id: number) {
  const [details, external, aliases] = await Promise.all([
    tmdb.series(id),
    tmdb.seriesExternalIds(id),
    tmdb.alternativeTitles("series", id),
  ]);
  if (details.id !== id || external.id !== id)
    throw new Error("Catalog series identity changed");
  return {
    details,
    identity: buildCatalogIdentity({
      kind: "series",
      tmdbId: id,
      originalTitle: details.original_name,
      imdbId: external.imdb_id,
      tvdbId: external.tvdb_id,
      titles: aliases.titles,
    }),
  };
}

/** Called with canonical scope locks held; merge only catalog-owned keys. */
export function mergeCatalogIdentity(
  existing: unknown,
  identity: CatalogIdentity,
  expected: { kind: "movie" | "series"; tmdbId: number },
) {
  assertCatalogAssociation(identity, expected);
  const ids = z.record(z.string(), z.json()).parse(existing);
  const previous =
    ids["catalogIdentity"] === undefined
      ? null
      : CatalogIdentitySchema.parse(ids["catalogIdentity"]);
  if (previous !== null) assertCatalogAssociation(previous, expected);
  for (const reference of identity.references) {
    const old = ids[reference.namespace];
    if (
      old !== undefined &&
      old !== null &&
      String(z.union([z.string(), z.number()]).parse(old)) !== reference.value
    )
      throw new Error(
        "Catalog external identity conflicts with existing mapping",
      );
    if (
      previous?.references.some(
        (item) =>
          item.kind === reference.kind &&
          item.namespace === reference.namespace &&
          item.value !== reference.value,
      ) === true
    )
      throw new Error("Catalog identity changed namespace association");
    ids[reference.namespace] =
      reference.namespace === "imdb"
        ? reference.value
        : Number(reference.value);
  }
  return { ...ids, catalogIdentity: identity };
}

function assertCatalogAssociation(
  value: CatalogIdentity,
  expected: { kind: "movie" | "series"; tmdbId: number },
) {
  const parsed = CatalogIdentitySchema.parse(value);
  const tmdb = parsed.references.filter((item) => item.namespace === "tmdb");
  if (
    parsed.references.some((item) => item.kind !== expected.kind) ||
    new Set(parsed.references.map((item) => item.namespace)).size !==
      parsed.references.length ||
    tmdb.length !== 1 ||
    tmdb[0]?.value !== String(z.int().positive().parse(expected.tmdbId))
  )
    throw new Error(
      "Catalog identity namespace conflicts with canonical media",
    );
}
