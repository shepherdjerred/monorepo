import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Database } from "#infrastructure/database.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { PlexClient } from "#integrations/plex.ts";
import type { FetchTransport } from "#integrations/http.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

/** Only external protocol responses are synthetic; files appear when the actual client submits. */
export function movieWorkflowWire(
  db: Database,
  input: {
    mediaId: string;
    edition: MovieEditionKey;
    downloads: string;
    bytes: Uint8Array;
  },
) {
  const hash = randomBytes(20).toString("hex");
  const label = MOVIE_EDITION_REGISTRY[input.edition].plexLabel;
  const title = `Workflow.Fixture.2020${label === "" ? "" : `.${label.replaceAll(" ", ".")}`}.1080p.WEB-DL.H264.ENG`;
  const name = `${title}.mkv`;
  let torrent: Record<string, unknown> | null = null;
  let adds = 0;
  const ratingKey = "750001";
  let watched = true;
  const providers = {
    withProvider: <T>(
      _id: string,
      work: (client: KnabenProvider) => Promise<T>,
    ) =>
      work(
        new KnabenProvider(() =>
          Promise.resolve(
            Response.json({
              hits: [
                {
                  id: "synthetic-workflow-release",
                  title,
                  bytes: input.bytes.byteLength,
                  hash,
                  seeders: 2,
                  details: "https://knaben.org/fixture",
                  magnetUrl: null,
                },
              ],
            }),
          ),
        ),
      ),
  };
  const qbittorrent = new QbittorrentClient(
    {
      baseUrl: "http://qbit.fixture",
      username: "synthetic",
      password: "synthetic",
      category: "media",
    },
    async (url, init) => {
      if (url.pathname.endsWith("/auth/login"))
        return new Response("Ok.", {
          headers: { "Set-Cookie": "SID=synthetic" },
        });
      if (url.pathname.endsWith("/torrents/info"))
        return Response.json(torrent === null ? [] : [torrent]);
      if (url.pathname.endsWith("/torrents/files"))
        return Response.json([
          {
            index: 0,
            name,
            size: input.bytes.byteLength,
            progress: 1,
            priority: 1,
          },
        ]);
      if (
        !url.pathname.endsWith("/torrents/add") ||
        !(init.body instanceof URLSearchParams)
      )
        throw new Error("Unexpected synthetic qBit route");
      const savePath = init.body.get("savepath");
      if (
        savePath === null ||
        !/^\/downloads\/media\/[a-f0-9-]{36}$/u.test(savePath)
      )
        throw new Error("Actual add escaped its owned download scope");
      const member = path.join(
        input.downloads,
        savePath.slice("/downloads/".length),
        name,
      );
      await mkdir(path.dirname(member), { recursive: true });
      await writeFile(member, input.bytes, { flag: "wx" });
      adds++;
      torrent = {
        hash,
        infohash_v1: hash,
        infohash_v2: "",
        tags: init.body.get("tags"),
        save_path: savePath,
        content_path: `${savePath}/${name}`,
        name,
        category: "media",
        state: "uploading",
        progress: 1,
        ratio: 0,
        seeding_time: 0,
        size: input.bytes.byteLength,
        ratio_limit: -1,
        seeding_time_limit: -1,
        inactive_seeding_time_limit: -1,
        max_ratio: -1,
        max_seeding_time: -1,
        max_inactive_seeding_time: -1,
        share_limit_action: "Stop",
        auto_tmm: false,
        force_start: false,
      };
      return Response.json({
        added_torrent_ids: [hash],
        success_count: 1,
        failure_count: 0,
        pending_count: 0,
      });
    },
  );
  const plexTransport: FetchTransport = async (url, init) => {
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
    if (
      url.pathname !== "/library/sections/1/all" &&
      url.pathname !== `/library/metadata/${ratingKey}`
    )
      throw new Error("Unexpected synthetic Plex route");
    const coverage = await db.assetCoverage.findMany({
      where: {
        mediaId: input.mediaId,
        edition: input.edition,
        current: true,
      },
      include: { asset: true },
    });
    if (coverage.length !== 1 || coverage[0] === undefined)
      throw new Error("Plex observation requires one actual published file");
    const asset = coverage[0].asset;
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: input.mediaId },
    });
    return Response.json({
      MediaContainer: {
        size: 1,
        totalSize: 1,
        Metadata: [
          {
            ratingKey,
            type: "movie",
            ...(new Headers(init.headers).get("X-Plex-Token") ===
            "synthetic-requester"
              ? { viewCount: watched ? 1 : 0 }
              : {}),
            title: media.title,
            Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
            ...(label === "" ? {} : { editionTitle: label }),
            Media: [
              {
                Part: [
                  {
                    id: 750_001,
                    file: asset.path,
                    size: Number(asset.sizeBytes),
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  };
  const plexClient = (token: string) =>
    new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token,
        clientIdentifier: "synthetic-workflow",
      },
      plexTransport,
    );
  return {
    providers,
    qbittorrent,
    plex: plexClient("synthetic"),
    userPlex: plexClient,
    additions: () => adds,
    ratingKey,
    setWatched: (value: boolean) => {
      watched = value;
    },
  };
}
