import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { LibraryReadSettings } from "./plex-access.ts";

type Where = Prisma.MediaItemWhereInput;
export type EpisodeAccess = {
  permittedMediaKinds: readonly string[];
  permittedSectionIds: readonly string[];
};

/** An episode sits directly under its series or under one of its seasons. */
export function anyEpisode(direct: Where, nested = direct): Where {
  return {
    OR: [
      { children: { some: direct } },
      { children: { some: { kind: "season", children: { some: nested } } } },
    ],
  };
}

function plexSection(equals: string | typeof Prisma.DbNull): Where {
  return { externalIds: { path: ["plexSectionId"], equals } };
}

/** Only a visible episode reachable through the visible title adds membership. */
export function coveredSeriesWhere(
  settings: LibraryReadSettings,
  plexIdentity: EpisodeAccess | null,
): Where | null {
  if (plexIdentity?.permittedMediaKinds.includes("series") !== true)
    return null;
  const { permittedSectionIds } = plexIdentity;
  if (permittedSectionIds.length === 0) return null;

  const allowed = permittedSectionIds.map((section) => plexSection(section));
  const missing = plexSection(Prisma.DbNull);
  const inherited = { OR: [...allowed, missing] };
  const section = settings.sections?.series;
  const rootSection =
    section !== undefined && permittedSectionIds.includes(section)
      ? inherited
      : { OR: allowed };
  const coveredEpisode = {
    kind: "episode",
    assets: { some: { edition: "default", current: true } },
    ...inherited,
  } satisfies Where;
  return {
    kind: "series",
    AND: [
      rootSection,
      anyEpisode(coveredEpisode, { ...coveredEpisode, parent: inherited }),
    ],
  };
}

const RollupSchema = z.array(
  z.object({
    seriesId: z.string(),
    total: z.int().nonnegative(),
    available: z.int().nonnegative(),
    external: z.boolean(),
  }),
);
export type SeriesEpisodeCounts = { available: number; total: number };

/**
 * Regular-season episode counts for a page of series, in one grouped query. A
 * series has no availability of its own; this is what a list shows instead.
 * The returned lookup answers for any of the given series.
 *
 * An episode sits directly under its series or under one of its seasons.
 * Specials (season 0) are left out of the counts. `available` is Media's own
 * lifecycle state. A registered external Plex library holds files Media does
 * not manage, and whether one of them is present right now takes a proof per
 * file that belongs to the title page; so a series with any episode covered
 * by such a file answers null, meaning unknown, rather than a count that would
 * read as "nothing here". A series with no episode rows yet counts zero of
 * zero. Callers pass only series the reader may see; every episode is counted
 * with its series.
 */
export async function seriesEpisodeCounts(
  tx: Prisma.TransactionClient,
  seriesIds: readonly string[],
): Promise<(seriesId: string) => SeriesEpisodeCounts | null> {
  const requested = new Set(seriesIds);
  const rows =
    requested.size === 0
      ? []
      : RollupSchema.parse(
          await tx.$queryRaw(Prisma.sql`
            SELECT episode."seriesId",
              (count(*) FILTER (WHERE episode.regular))::int AS total,
              (count(*) FILTER (
                WHERE episode.regular AND episode.availability = 'available'
              ))::int AS available,
              bool_or(EXISTS (
                SELECT 1 FROM "AssetCoverage" coverage
                JOIN "LibraryAsset" asset ON asset.id = coverage."assetId"
                WHERE coverage."mediaId" = episode.id
                  AND coverage.edition = 'default'
                  AND coverage."current" AND NOT asset.owned
              )) AS external
            FROM (
              SELECT direct.id, direct."parentId" AS "seriesId", direct.availability,
                direct."seasonNumber" IS DISTINCT FROM 0 AS regular
              FROM "MediaItem" direct
              WHERE direct.kind = 'episode'
                AND direct."parentId" IN (${Prisma.join([...requested])})
              UNION ALL
              SELECT nested.id, season."parentId", nested.availability,
                nested."seasonNumber" IS DISTINCT FROM 0
              FROM "MediaItem" nested
              JOIN "MediaItem" season ON season.id = nested."parentId"
              WHERE nested.kind = 'episode' AND season.kind = 'season'
                AND season."parentId" IN (${Prisma.join([...requested])})
            ) episode
            GROUP BY episode."seriesId"
          `),
        );
  const counted = new Map(rows.map((row) => [row.seriesId, row]));
  return (seriesId) => {
    if (!requested.has(seriesId))
      throw new Error("Episode counts were not read for this series");
    const row = counted.get(seriesId);
    if (row === undefined) return { available: 0, total: 0 };
    return row.external ? null : { available: row.available, total: row.total };
  };
}
