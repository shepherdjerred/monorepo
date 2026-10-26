import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import type { FetchTransport } from "#integrations/http.ts";

let nextKey = 100_000;

/** Synthetic HTTP only; paths and canonical identities come from the actual physical producer. */
export async function retentionPlexContext(
  db: Database,
  base: MediaAutomationContext,
  mediaIds: readonly string[],
) {
  const ids = [...new Set(mediaIds)].sort();
  const canonical = await readPlexCanonicalTargets(
    db,
    ids.map((mediaId) => ({ mediaId, edition: "default" })),
  );
  const coverage = await db.assetCoverage.findMany({
    where: { mediaId: { in: ids }, edition: "default", current: true },
    include: { asset: true, media: true },
  });
  const metadata = new Map<string, PlexItem>();
  const items = new Map<string, PlexItem>();
  const roots = new Map<string, string>();
  const seasons = new Map<string, string>();
  const parts = new Map<string, number>();
  for (const target of canonical) {
    const rows = coverage.filter((row) => row.mediaId === target.scope.mediaId);
    const row = rows[0];
    if (row === undefined || rows.length !== 1)
      throw new Error("Retention fixture requires exact physical coverage");
    let partId = parts.get(row.assetId);
    if (partId === undefined) {
      partId = nextKey++;
      parts.set(row.assetId, partId);
    }
    const item: PlexItem = {
      ratingKey: String(nextKey++),
      type: target.kind,
      title: row.media.title,
      Media: [
        {
          Part: [
            {
              id: partId,
              file: row.asset.path,
              size: Number(row.asset.sizeBytes),
            },
          ],
        },
      ],
    };
    if (target.kind === "movie")
      item.Guid = target.references.map((ref) => ({
        id: `${ref.namespace}://${ref.value}`,
      }));
    else {
      let show = roots.get(target.canonicalRootId);
      if (show === undefined) {
        show = String(nextKey++);
        roots.set(target.canonicalRootId, show);
        metadata.set(show, {
          ratingKey: show,
          type: "show",
          title: "Synthetic canonical series",
          Guid: target.references.map((ref) => ({
            id: `${ref.namespace}://${ref.value}`,
          })),
        });
      }
      const seasonKey = `${show}:${String(target.coordinate.seasonNumber)}`;
      let season = seasons.get(seasonKey);
      if (season === undefined) {
        season = String(nextKey++);
        seasons.set(seasonKey, season);
        metadata.set(season, {
          ratingKey: season,
          type: "season",
          title: "Synthetic season",
          index: target.coordinate.seasonNumber,
          parentRatingKey: show,
        });
      }
      Object.assign(item, {
        index: target.coordinate.episodeNumber,
        parentIndex: target.coordinate.seasonNumber,
        parentRatingKey: season,
        grandparentRatingKey: show,
      });
    }
    items.set(target.scope.mediaId, item);
    metadata.set(item.ratingKey, item);
  }
  const access = await Promise.all(
    [
      ...new Set(
        canonical.map((target) =>
          target.kind === "movie" ? ("movie" as const) : ("show" as const),
        ),
      ),
    ]
      .sort()
      .map((kind) => base.plexAccess(kind)),
  );
  const server = access[0]?.serverMachineId;
  if (
    server === undefined ||
    access.some((value) => value.serverMachineId !== server)
  )
    throw new Error("Synthetic retention server mismatch");
  const state: {
    watched: boolean | null;
    sessions: PlexItem[];
    watchOverrides: Map<string, boolean | null>;
    beforeMetadata?: () => Promise<void>;
  } = { watched: true, sessions: [], watchOverrides: new Map() };
  const calls: string[] = [];
  const metadataResponse = async (url: URL) => {
    await state.beforeMetadata?.();
    const item = metadata.get(url.pathname.slice("/library/metadata/".length));
    const watched =
      item !== undefined && state.watchOverrides.has(item.ratingKey)
        ? state.watchOverrides.get(item.ratingKey)
        : state.watched;
    if (watched === undefined)
      throw new Error("Synthetic watch override missing");
    if (
      item === undefined ||
      (watched === null && ["movie", "episode"].includes(item.type))
    )
      return new Response(null, { status: 404 });
    return Response.json({
      MediaContainer: {
        size: 1,
        Metadata: [{ ...item, viewCount: watched === true ? 1 : 0 }],
      },
    });
  };
  const transport: FetchTransport = async (url) => {
    calls.push(url.pathname);
    if (url.pathname === "/identity")
      return Response.json({ MediaContainer: { machineIdentifier: server } });
    if (url.pathname === "/library/sections")
      return Response.json({
        MediaContainer: {
          size: access.length,
          Directory: access.map((value) => ({
            key: value.sectionId,
            type: value.sectionType,
            title: "Synthetic retention library",
          })),
        },
      });
    if (url.pathname === "/status/sessions")
      return Response.json({
        MediaContainer: {
          size: state.sessions.length,
          Metadata: state.sessions,
        },
      });
    for (const section of access) {
      if (url.pathname === `/library/sections/${section.sectionId}/refresh`)
        return new Response(null, { status: 200 });
      if (url.pathname === `/library/sections/${section.sectionId}/all`) {
        const matches = [...items.values()].filter(
          (item) =>
            item.type ===
            (section.sectionType === "movie" ? "movie" : "episode"),
        );
        const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
        const limit = Number(url.searchParams.get("X-Plex-Container-Size"));
        const page = matches.slice(offset, offset + limit);
        return Response.json({
          MediaContainer: {
            size: page.length,
            totalSize: matches.length,
            Metadata: page,
          },
        });
      }
    }
    if (url.pathname.startsWith("/library/metadata/"))
      return await metadataResponse(url);
    throw new Error(`Unexpected synthetic retention request ${url.pathname}`);
  };
  const client = (token: string) =>
    new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token,
        clientIdentifier: "retention-fixture",
      },
      transport,
    );
  const context: MediaAutomationContext = {
    ...base,
    serverMachineId: server,
    plex: client("synthetic-owner"),
    userPlex: client,
  };
  return { context, state, items, metadata, calls };
}
