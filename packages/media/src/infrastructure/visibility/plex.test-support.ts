import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { FetchTransport } from "#integrations/http.ts";

let nextKey = 300_000;
const key = () => String(nextKey++);

/** Synthetic Plex only; paths, complete coverage and identities come from actual publication rows. */
export async function visibilityPublicationContext(
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
    include: { asset: true },
    orderBy: { mediaId: "asc" },
  });
  if (rows.length !== mediaIds.length)
    throw new Error("Visibility publication omitted an actual asset");
  const targets = await readPlexCanonicalTargets(
    db,
    rows.map((row) => ({ mediaId: row.mediaId, edition: "default" })),
  );
  const kind = targets[0]?.kind;
  if (kind === undefined || targets.some((target) => target.kind !== kind))
    throw new Error("Visibility fixture requires one library kind");
  const access = await base.plexAccess(kind === "movie" ? "movie" : "show");
  const metadata = new Map<string, PlexItem>();
  const roots = new Map<string, string>();
  const seasons = new Map<string, string>();
  const parts = new Map<string, number>();
  const items: PlexItem[] = targets.map((target) => {
    const row = rows.find((value) => value.mediaId === target.scope.mediaId);
    if (row === undefined)
      throw new Error("Visibility canonical member lacks physical coverage");
    let part = parts.get(row.assetId);
    if (part === undefined) {
      part = nextKey++;
      parts.set(row.assetId, part);
    }
    const item: PlexItem = {
      ratingKey: key(),
      type: target.kind,
      title: "Synthetic published item",
      Media: [{ Part: [{ id: part, file: row.asset.path }] }],
    };
    if (target.kind === "movie") {
      item.Guid = target.references.map((ref) => ({
        id: `${ref.namespace}://${ref.value}`,
      }));
    } else {
      let show = roots.get(target.canonicalRootId);
      if (show === undefined) {
        show = key();
        roots.set(target.canonicalRootId, show);
        metadata.set(show, {
          ratingKey: show,
          type: "show",
          title: "Synthetic published series",
          Guid: target.references.map((ref) => ({
            id: `${ref.namespace}://${ref.value}`,
          })),
        });
      }
      const seasonKey = `${show}/${String(target.coordinate.seasonNumber)}`;
      let season = seasons.get(seasonKey);
      if (season === undefined) {
        season = key();
        seasons.set(seasonKey, season);
        metadata.set(season, {
          ratingKey: season,
          type: "season",
          title: "Synthetic published season",
          index: target.coordinate.seasonNumber,
          parentRatingKey: show,
        });
      }
      Object.assign(item, {
        parentRatingKey: season,
        grandparentRatingKey: show,
        parentIndex: target.coordinate.seasonNumber,
        index: target.coordinate.episodeNumber,
      });
      if (target.coordinate.tmdbEpisodeId !== null)
        item.Guid = [
          { id: `tmdb://${String(target.coordinate.tmdbEpisodeId)}` },
        ];
    }
    metadata.set(item.ratingKey, item);
    return item;
  });
  const calls: string[] = [];
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "synthetic",
      clientIdentifier: "visibility",
    },
    visibilityPlexTransport({ access, items, metadata, calls }),
  );
  return { context: { ...base, plex }, calls, items };
}

function visibilityPlexTransport(input: {
  access: PlexAccess;
  items: PlexItem[];
  metadata: ReadonlyMap<string, PlexItem>;
  calls: string[];
}): FetchTransport {
  const { access, items, metadata, calls } = input;
  return (url) => {
    calls.push(url.pathname);
    if (url.pathname === "/identity")
      return Promise.resolve(
        Response.json({
          MediaContainer: { machineIdentifier: access.serverMachineId },
        }),
      );
    if (url.pathname === "/library/sections")
      return Promise.resolve(
        Response.json({
          MediaContainer: {
            size: 1,
            Directory: [
              {
                key: access.sectionId,
                type: access.sectionType,
                title: "Synthetic visibility library",
              },
            ],
          },
        }),
      );
    if (url.pathname === `/library/sections/${access.sectionId}/refresh`)
      return Promise.resolve(new Response(null, { status: 200 }));
    if (url.pathname === `/library/sections/${access.sectionId}/all`) {
      const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
      const limit = Number(url.searchParams.get("X-Plex-Container-Size"));
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
    const item = metadata.get(url.pathname.slice("/library/metadata/".length));
    return item !== undefined && url.pathname.startsWith("/library/metadata/")
      ? Promise.resolve(
          Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
        )
      : Promise.reject(
          new Error(`Unexpected visibility Plex request: ${url.pathname}`),
        );
  };
}
