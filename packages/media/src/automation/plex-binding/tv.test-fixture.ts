import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";

/** Injected Plex transport, with actual canonical records and complete page envelopes. */
export async function tvBindingContext(
  db: Database,
  base: MediaAutomationContext,
  mediaIds: readonly string[],
) {
  const rows = await db.assetCoverage.findMany({
    where: {
      mediaId: { in: [...mediaIds] },
      current: true,
      edition: "default",
    },
    include: { asset: true, media: { include: { parent: true } } },
    orderBy: { mediaId: "asc" },
  });
  const series = rows[0]?.media.parent;
  if (
    series?.kind !== "series" ||
    series.tmdbId === null ||
    rows.some((row) => row.media.parentId !== series.id)
  )
    throw new Error(
      "TV binding fixture requires complete known series coverage",
    );
  const catalog = await db.mediaItem.findMany({
    where: { kind: "episode", parentId: series.id },
    orderBy: { episodeNumber: "asc" },
  });
  const assetKeys = [...new Set(rows.map((row) => row.assetId))].sort();
  const items: PlexItem[] = catalog.map((media, index) => {
    if (media.episodeNumber === null || media.seasonNumber !== 1)
      throw new Error("Unexpected TV fixture coordinate");
    const coverage = rows.find((row) => row.mediaId === media.id);
    return {
      ratingKey: String(1000 + index),
      type: "episode",
      title: media.title,
      index: media.episodeNumber,
      parentIndex: 1,
      parentRatingKey: "20",
      grandparentRatingKey: "10",
      Media: [
        {
          Part: [
            {
              id:
                coverage === undefined
                  ? 20_000 + index
                  : 10_000 + assetKeys.indexOf(coverage.assetId),
              file: coverage?.asset.path ?? `/data/tv/foreign/${media.id}.mkv`,
              size: Number(coverage?.asset.sizeBytes ?? 1n),
            },
          ],
        },
      ],
    };
  });
  const show: PlexItem = {
    ratingKey: "10",
    type: "show",
    title: series.title,
    Guid: [{ id: `tmdb://${String(series.tmdbId)}` }],
  };
  const season: PlexItem = {
    ratingKey: "20",
    type: "season",
    title: "Season 1",
    index: 1,
    parentRatingKey: "10",
  };
  const pages: number[] = [];
  const context: MediaAutomationContext = {
    ...base,
    plexAccess: (kind) => {
      if (kind !== "show")
        throw new Error("TV binding must not resolve movie configuration");
      return Promise.resolve({
        serverMachineId: "fixture-server",
        sectionType: kind,
        sectionId: "2",
      });
    },
    plex: new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: "synthetic",
        clientIdentifier: "synthetic",
      },
      (url) => {
        if (url.pathname === "/library/sections/2/refresh")
          return Promise.resolve(new Response(null, { status: 200 }));
        if (url.pathname === "/identity")
          return Promise.resolve(
            Response.json({
              MediaContainer: { machineIdentifier: "fixture-server" },
            }),
          );
        if (url.pathname === "/library/sections")
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: 1,
                Directory: [{ key: "2", type: "show", title: "Synthetic TV" }],
              },
            }),
          );
        if (url.pathname === "/library/sections/2/all") {
          const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
          const limit = Number(url.searchParams.get("X-Plex-Container-Size"));
          pages.push(offset);
          const page = items.slice(offset, offset + limit);
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: page.length,
                totalSize: items.length,
                Metadata: page,
              },
            }),
          );
        }
        const key = url.pathname.slice("/library/metadata/".length);
        const item =
          key === "10"
            ? show
            : key === "20"
              ? season
              : items.find((value) => value.ratingKey === key);
        return item === undefined ||
          !url.pathname.startsWith("/library/metadata/")
          ? Promise.reject(
              new Error(`Unexpected TV fixture request ${url.pathname}`),
            )
          : Promise.resolve(
              Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
            );
      },
    ),
  };
  return { context, rows, catalog, series, show, items, pages };
}
