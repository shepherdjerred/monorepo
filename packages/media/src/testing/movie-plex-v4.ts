import { rm } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { inspectAndStageMovieV4 } from "#automation/files/movie-editions/inspection.ts";
import { promoteMovieV4 } from "#automation/files/movie-editions/publication.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

/** Real PG/media tools/files; provider, qBittorrent and Plex HTTP and ownership attestations are synthetic. */
export async function moviePlexV4Fixture(
  db: Database,
  network: MediaAutomationContext,
  base: Parameters<typeof movieFilesV4Fixture>[2],
  options: { bytes: Uint8Array; edition: MovieEditionKey },
) {
  const f = await movieFilesV4Fixture(db, network, base, options);
  try {
    await inspectAndStageMovieV4(f.files.context, f.input);
    await promoteMovieV4(f.files.context, f.input);
    const assets = await db.assetCoverage.findMany({
      where: { mediaId: f.media.id, edition: options.edition, current: true },
      include: { asset: true },
    });
    const asset = assets[0]?.asset;
    if (asset === undefined || assets.length !== 1)
      throw new Error("Actual file publication missing");
    const partId = 710_000 + (await db.libraryAsset.count());
    const item: PlexItem = {
      ratingKey: String(partId),
      type: "movie",
      title: f.media.title,
      Guid: [{ id: `tmdb://${String(f.media.tmdbId)}` }],
      Media: [
        {
          Part: [
            { id: partId, file: asset.path, size: options.bytes.byteLength },
          ],
        },
      ],
      ...(options.edition === "default"
        ? {}
        : { editionTitle: MOVIE_EDITION_REGISTRY[options.edition].plexLabel }),
    };
    const calls: URL[] = [];
    let checkpoint = (_url: URL) => Promise.resolve();
    const plex = new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: "fixture",
        clientIdentifier: "fixture",
      },
      async (url) => {
        calls.push(url);
        await checkpoint(url);
        if (url.pathname === "/identity")
          return Response.json({
            MediaContainer: { machineIdentifier: "fixture-server" },
          });
        if (url.pathname === "/library/sections")
          return Response.json({
            MediaContainer: {
              size: 1,
              Directory: [{ key: "1", type: "movie", title: "Movies" }],
            },
          });
        if (url.pathname === "/library/sections/1/refresh")
          return new Response(null, { status: 200 });
        if (url.pathname === "/library/sections/1/all")
          return Response.json({
            MediaContainer: { size: 1, totalSize: 1, Metadata: [item] },
          });
        if (url.pathname === `/library/metadata/${item.ratingKey}`)
          return Response.json({
            MediaContainer: { size: 1, Metadata: [item] },
          });
        throw new Error(`Unexpected scoped Plex fixture path: ${url.pathname}`);
      },
    );
    return {
      ...f,
      asset,
      item,
      calls,
      network: { ...f.context, plex },
      checkpoint: (value: typeof checkpoint) => {
        checkpoint = value;
      },
    };
  } catch (error) {
    await rm(f.files.directory, { recursive: true, force: true });
    throw error;
  }
}
