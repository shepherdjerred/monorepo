import { expect } from "vitest";
import type { MediaRequest } from "./client.ts";
import type { MediaHistory, MediaTorrent } from "./contracts.ts";

export const hash = "a".repeat(40);
export const credentials = {
  sonarr: "fixture",
  radarr: "fixture",
  username: "fixture",
  password: "fixture",
};
const json = (value: unknown) => Response.json(value);
const page = (records: unknown[]) =>
  json({ records, totalRecords: records.length });

function newModel(app: "sonarr" | "radarr") {
  const torrent: MediaTorrent = {
    hash,
    category: app === "sonarr" ? "tv-sonarr" : "radarr",
    content_path: "/downloads/fake.mkv.exe",
    save_path: "/downloads/",
    download_path: "/downloads/incomplete/",
  };
  const history: MediaHistory[] = [
    {
      id: 1,
      eventType: "grabbed",
      downloadId: hash.toUpperCase(),
      sourceTitle: "Fixture",
      seriesId: 99,
      movieId: 99,
    },
  ];
  const blocklist: {
    sourceTitle: string;
    seriesId: number;
    movieId: number;
  }[] = [];
  const writes: string[] = [];
  return {
    torrent,
    torrents: [torrent],
    files: [{ name: "fake.mkv.exe" }],
    history,
    blocklist,
    writes,
    indexers: { sonarr: [0, 1], radarr: [0, 1] },
    failAfterWrite: false,
    failBlocklist: false,
    wrongOwner: false,
    failed: false,
  };
}
type Model = ReturnType<typeof newModel>;

function fail(model: Model, url: URL) {
  expect(url.searchParams.get("removeFromClient")).toBe("false");
  expect(url.searchParams.get("blocklist")).toBe("true");
  expect(url.searchParams.get("skipRedownload")).toBe("false");
  model.failed = true;
  model.history.push({
    id: 2,
    eventType: "downloadFailed",
    downloadId: hash.toUpperCase(),
    sourceTitle: "Fixture",
    seriesId: 99,
    movieId: 99,
  });
  if (!model.failBlocklist)
    model.blocklist.push({ sourceTitle: "Fixture", seriesId: 99, movieId: 99 });
  if (model.failAfterWrite)
    throw new Error("Response lost after failure committed");
  return json({});
}

function qbtResponse(
  endpoint: string,
  model: Model,
  body: RequestInit["body"],
) {
  switch (endpoint) {
    case "auth/login":
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "QBT_SID_8080=fixture; HttpOnly" },
      });
    case "torrents/info":
      return json(model.torrents);
    case "torrents/files":
      return json(model.files);
    case "torrents/stop":
      return new Response();
    case "torrents/delete":
      expect(model.blocklist).toHaveLength(1);
      expect(body instanceof URLSearchParams && body.get("deleteFiles")).toBe(
        "true",
      );
      model.torrents = [];
      return new Response();
    default:
      return;
  }
}

function arrResponse(
  model: Model,
  service: "sonarr" | "radarr",
  url: URL,
  method: string | undefined,
) {
  const endpoint = url.pathname.replace(/^\/api\/v[23]\//u, "");
  switch (endpoint) {
    case "indexer":
    case "indexer/1": {
      if (method === "PUT") model.indexers[service] = [0, 1];
      const indexer = {
        id: 1,
        fields: [
          { name: "failDownloads", value: model.indexers[service] },
          { name: "apiKey", value: "unchanged" },
        ],
      };
      return json(endpoint === "indexer" ? [indexer] : indexer);
    }
    case "history":
      return page(model.wrongOwner ? [] : model.history);
    case "queue":
      return page(
        model.failed ? [] : [{ id: 5, downloadId: hash.toUpperCase() }],
      );
    case "blocklist":
      return page(model.blocklist);
    case "queue/5":
      return fail(model, url);
    default:
      throw new Error(`Unhandled fixture endpoint: ${endpoint}`);
  }
}

export function fixture(app: "sonarr" | "radarr" = "sonarr") {
  const model = newModel(app);
  const request: MediaRequest = (input, init) => {
    const url = new URL(input);
    const endpoint = url.pathname.replace(/^\/api\/v[23]\//u, "");
    const service = url.hostname.includes("sonarr") ? "sonarr" : "radarr";
    if (
      endpoint !== "auth/login" &&
      init?.method !== undefined &&
      init.method !== "GET"
    ) {
      model.writes.push(`${service}:${init.method}:${endpoint}`);
    }
    return Promise.resolve(
      qbtResponse(endpoint, model, init?.body) ??
        arrResponse(model, service, url, init?.method),
    );
  };
  return { model, request, torrent: model.torrent };
}
