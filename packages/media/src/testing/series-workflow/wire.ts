import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Database } from "#infrastructure/database.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { PlexClient, type PlexItem } from "#integrations/plex.ts";

/** External wires are synthetic; the real clients create their actual transfer and file-member observations. */
export function managedSeriesWire(
  db: Database,
  input: {
    seriesId: string;
    mediaIds: string[];
    title: string;
    downloads: string;
    bytes: Uint8Array;
    items: PlexItem[];
    show: PlexItem;
    episodeSpan?: { season: number; first: number; last: number };
    members?: {
      season: number;
      first: number;
      last: number;
      bytes: Uint8Array;
    }[];
  },
) {
  const hash = randomBytes(20).toString("hex");
  const span = input.episodeSpan ?? { season: 1, first: 1, last: 2 };
  const season = `S${String(span.season).padStart(2, "0")}`;
  const episodes = `${season}E${String(span.first).padStart(2, "0")}${span.first === span.last ? "" : `-E${String(span.last).padStart(2, "0")}`}`;
  const title = `${input.title.replaceAll(" ", ".")}.2020.${span.first === span.last ? episodes : season}.1080p.WEB-DL.H264.English-MEDIA`;
  const member = title.replace(`.${season}.`, `.${episodes}.`) + ".mkv";
  const members =
    input.members === undefined
      ? [{ name: member, bytes: input.bytes }]
      : input.members.map((part) => ({
          name:
            title.replace(`.${season}.`, `.${episodeLabel(part)}.`) + ".mkv",
          bytes: part.bytes,
        }));
  const firstMember = members[0];
  if (
    firstMember === undefined ||
    new Set(members.map((part) => part.name)).size !== members.length
  )
    throw new Error("Synthetic series members must be nonempty and distinct");
  const size = members.reduce((sum, part) => sum + part.bytes.byteLength, 0);
  let torrent: Record<string, unknown> | null = null;
  let adds = 0;
  const control = {
    loseReply: false,
    visible: true,
    beforeInfo: () => Promise.resolve(),
  };
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
                  id: `synthetic-series:${input.seriesId}:${episodes}`,
                  title,
                  bytes: size,
                  hash,
                  seeders: 2,
                  details: "https://knaben.org/",
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
      if (url.pathname.endsWith("/torrents/info")) {
        await control.beforeInfo();
        return Response.json(
          torrent === null || !control.visible ? [] : [torrent],
        );
      }
      if (url.pathname.endsWith("/torrents/files"))
        return Response.json(
          members.map((part, index) => ({
            index,
            name: part.name,
            size: part.bytes.byteLength,
            progress: 1,
            priority: 1,
          })),
        );
      if (
        !url.pathname.endsWith("/torrents/add") ||
        !(init.body instanceof URLSearchParams)
      )
        throw new Error("Unexpected series transfer route");
      const savePath = init.body.get("savepath");
      if (
        savePath === null ||
        !/^\/downloads\/media\/[a-f0-9-]{36}$/u.test(savePath)
      )
        throw new Error("Series transfer escaped its actual attempt");
      const directory = path.join(
        input.downloads,
        savePath.slice("/downloads/".length),
      );
      await mkdir(directory, { recursive: true });
      for (const part of members)
        await writeFile(path.join(directory, part.name), part.bytes, {
          flag: "wx",
        });
      adds++;
      torrent = {
        hash,
        infohash_v1: hash,
        infohash_v2: "",
        tags: init.body.get("tags"),
        save_path: savePath,
        content_path:
          members.length === 1 ? `${savePath}/${firstMember.name}` : savePath,
        name: members.length === 1 ? firstMember.name : title,
        category: "media",
        state: "uploading",
        progress: 1,
        ratio: 0,
        seeding_time: 0,
        size,
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
      return control.loseReply
        ? new Response("", { status: 503 })
        : Response.json({
            added_torrent_ids: [hash],
            success_count: 1,
            failure_count: 0,
            pending_count: 0,
          });
    },
  );
  const currentItems = async () => {
    const coverage = await db.assetCoverage.findMany({
      where: {
        mediaId: { in: input.mediaIds },
        edition: "default",
        current: true,
      },
      include: { asset: true },
    });
    return input.items.map((item, index) => {
      const mediaId = input.mediaIds[index];
      const row = coverage.find((candidate) => candidate.mediaId === mediaId);
      const original = item.Media?.[0]?.Part[0];
      if (row === undefined || original === undefined)
        throw new Error("Actual managed series lost complete Part coverage");
      return {
        ...item,
        viewCount: 3,
        lastViewedAt: 1_234_567,
        viewOffset: 456_000,
        Media: [
          {
            Part: [
              {
                ...original,
                file: row.asset.path,
                size: Number(row.asset.sizeBytes),
              },
            ],
          },
        ],
      };
    });
  };
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "synthetic",
      clientIdentifier: "synthetic",
    },
    async (url) => {
      if (url.pathname === "/identity")
        return Response.json({
          MediaContainer: { machineIdentifier: "fixture-server" },
        });
      if (url.pathname === "/library/sections")
        return Response.json({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "2", type: "show", title: "Synthetic TV" }],
          },
        });
      if (url.pathname === "/library/sections/2/refresh")
        return new Response(null, { status: 200 });
      const items = await currentItems();
      if (url.pathname === "/library/sections/2/all")
        return Response.json({
          MediaContainer: {
            size: items.length,
            totalSize: items.length,
            Metadata: items,
          },
        });
      const key = url.pathname.slice("/library/metadata/".length);
      const selected =
        key === input.show.ratingKey
          ? input.show
          : key === input.items[0]?.parentRatingKey
            ? {
                ratingKey: key,
                type: "season",
                title: "Season 1",
                index: span.season,
                parentRatingKey: input.show.ratingKey,
              }
            : items.find((item) => item.ratingKey === key);
      if (
        selected === undefined ||
        !url.pathname.startsWith("/library/metadata/")
      )
        throw new Error("Unexpected managed series Plex route");
      return Response.json({
        MediaContainer: { size: 1, Metadata: [selected] },
      });
    },
  );
  return { providers, qbittorrent, plex, additions: () => adds, control };
}

function episodeLabel(span: { season: number; first: number; last: number }) {
  return `S${String(span.season).padStart(2, "0")}E${String(span.first).padStart(2, "0")}${span.first === span.last ? "" : `-E${String(span.last).padStart(2, "0")}`}`;
}
