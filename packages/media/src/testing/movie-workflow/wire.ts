import path from "node:path";
import { z } from "zod";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Database } from "#infrastructure/database.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";
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
    title?: string;
    year?: number;
    resolution?: 1080 | 2160;
    sceneStyle?: boolean;
    providerReleaseId?: string;
    ratingKey?: string;
    partId?: number;
    playback?: {
      viewCount?: number | undefined;
      lastViewedAt?: number | undefined;
      viewOffset?: number | undefined;
    };
  },
) {
  const hash = randomBytes(20).toString("hex");
  const label = MOVIE_EDITION_REGISTRY[input.edition].plexLabel;
  const title = `${(input.title ?? "Workflow Fixture").replaceAll(" ", ".")}.${String(input.year ?? 2020)}${label === "" ? "" : `.${label.replaceAll(" ", ".")}`}.${String(input.resolution ?? 1080)}p.WEB-DL.H264.${input.sceneStyle === true ? "English-MEDIA" : "ENG"}`;
  const name = `${title}.mkv`;
  let torrent: Record<string, unknown> | null = null;
  let adds = 0;
  const sessions: PlexItem[] = [];
  const control = {
    sessions,
    loseAddReply: false,
    loseRemoveReply: false,
    deletes: 0,
    ratio: 0,
    seedingSeconds: 0,
    visible: true,
    beforeProvider: () => Promise.resolve(),
    beforeInfo: () => Promise.resolve(),
    beforeAddReply: () => Promise.resolve(),
    beforeRemove: () => Promise.resolve(),
    beforeMetadata: () => Promise.resolve(),
  };
  const ratingKey = input.ratingKey ?? "750001";
  let watched = true;
  const providers = {
    withProvider: <T>(
      _id: string,
      work: (client: KnabenProvider) => Promise<T>,
    ) =>
      work(
        new KnabenProvider(async () => {
          await control.beforeProvider();
          return Response.json({
            hits: [
              {
                id: input.providerReleaseId ?? "synthetic-workflow-release",
                title,
                bytes: input.bytes.byteLength,
                hash,
                seeders: 2,
                details: "https://knaben.org/fixture",
                magnetUrl: null,
              },
            ],
          });
        }),
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
      if (url.pathname.endsWith("/torrents/info")) {
        await control.beforeInfo();
        if (torrent !== null) {
          torrent["ratio"] = control.ratio;
          torrent["seeding_time"] = control.seedingSeconds;
        }
        return Response.json(
          torrent === null || !control.visible ? [] : [torrent],
        );
      }
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
      const form = z.instanceof(URLSearchParams).parse(init.body);
      if (url.pathname.endsWith("/torrents/delete")) {
        if (form.get("hashes") !== hash || form.get("deleteFiles") !== "true")
          throw new Error("Actual delete escaped its exact synthetic source");
        await control.beforeRemove();
        const source = z.object({ save_path: z.string() }).parse(torrent);
        const originalPath = path.join(
          input.downloads,
          source.save_path.slice("/downloads/".length),
          name,
        );
        await rm(originalPath);
        control.deletes++;
        torrent = null;
        return new Response("", {
          status: control.loseRemoveReply ? 503 : 200,
        });
      }
      if (!url.pathname.endsWith("/torrents/add"))
        throw new Error("Unexpected synthetic qBit route");
      const savePath = form.get("savepath");
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
        tags: form.get("tags"),
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
      await control.beforeAddReply();
      if (control.loseAddReply) return new Response("", { status: 503 });
      return Response.json({
        added_torrent_ids: [hash],
        success_count: 1,
        failure_count: 0,
        pending_count: 0,
      });
    },
  );
  const plexTransport: FetchTransport = async (url, init) => {
    if (url.pathname === "/status/sessions")
      return Response.json({
        MediaContainer: {
          size: control.sessions.length,
          Metadata: control.sessions,
        },
      });
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
    if (url.pathname.startsWith("/library/metadata/"))
      await control.beforeMetadata();
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
            ...input.playback,
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
                    id: input.partId ?? 750_001,
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
    control,
  };
}
