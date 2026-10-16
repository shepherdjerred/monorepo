import { describe, expect, test } from "vitest";
import { runMediaSafety } from "./guard.ts";
import { MediaApi, type MediaRequest } from "./client.ts";
import { assertRemovalPaths, dangerousFiles } from "./contracts.ts";
import { reconcileIndexerSafety } from "./arr.ts";
import { fixture, credentials } from "./guard.fixture.ts";

describe("media download safety", () => {
  test.each(["sonarr", "radarr"] as const)(
    "fails, blocklists, then removes a confirmed %s fake",
    async (app) => {
      const { model, request } = fixture(app);
      const result = await runMediaSafety(credentials, true, request);
      expect(result.removed[app]).toBe(1);
      expect(model.writes.map((entry) => entry.split(":").at(-1))).toEqual([
        "torrents/stop",
        "queue/5",
        "torrents/delete",
      ]);
      const repeated = await runMediaSafety(credentials, true, request);
      expect(repeated.candidates).toEqual([]);
      expect(model.writes).toHaveLength(3);
    },
  );

  test("observation reports candidates and missing protections without writes", async () => {
    const { model, request } = fixture();
    model.indexers.sonarr = [];
    const result = await runMediaSafety(credentials, false, request);
    expect(result.candidates).toHaveLength(1);
    expect(result.indexersChanged).toBe(1);
    expect(model.writes).toEqual([]);
  });

  test.each([
    { files: [] },
    { files: [{ name: "episode.mkv" }, { name: "subtitle.srt" }] },
    { files: [{ name: "archive.rar" }] },
  ])(
    "leaves missing metadata and ordinary content alone: %j",
    async ({ files }) => {
      const { model, request } = fixture();
      model.files = files;
      const repeated = await runMediaSafety(credentials, true, request);
      expect(repeated.candidates).toEqual([]);
      expect(model.writes).toEqual([]);
    },
  );

  test("rejects dangerous sidecars even alongside a video", async () => {
    const { model, request } = fixture();
    model.files = [{ name: "episode.mkv" }, { name: "Watch.Video.LNK" }];
    const result = await runMediaSafety(credentials, true, request);
    expect(result.removed.sonarr).toBe(1);
  });

  test.each(["unmanaged category", "missing grabbed history"])(
    "retains downloads with %s",
    async (scenario) => {
      const { model, request, torrent } = fixture();
      if (scenario === "unmanaged category") torrent.category = "books";
      else model.wrongOwner = true;
      const repeated = await runMediaSafety(credentials, true, request);
      expect(repeated.candidates).toEqual([]);
      expect(model.writes).toEqual([]);
    },
  );

  test("reads back a lost failure response before retrying; never repeats replacement search", async () => {
    const { model, request } = fixture();
    model.failAfterWrite = true;
    await expect(runMediaSafety(credentials, true, request)).rejects.toThrow(
      "queue/5 request failed or timed out",
    );
    expect(model.torrents).toHaveLength(1);
    await runMediaSafety(credentials, true, request);
    expect(
      model.writes.filter((entry) => entry.endsWith("queue/5")),
    ).toHaveLength(1);
    expect(model.torrents).toHaveLength(0);
  });

  test("never removes a torrent or repeats failure when the blocklist cannot be verified", async () => {
    const { model, request } = fixture();
    model.failBlocklist = true;
    await expect(runMediaSafety(credentials, true, request)).rejects.toThrow(
      "not observed",
    );
    await expect(runMediaSafety(credentials, true, request)).rejects.toThrow(
      "no corresponding blocklist",
    );
    expect(model.torrents).toHaveLength(1);
    expect(
      model.writes.filter((entry) => entry.endsWith("queue/5")),
    ).toHaveLength(1);
  });

  test("slow indexer validation cannot prevent content cleanup", async () => {
    const { model, request } = fixture();
    model.indexers.sonarr = [];
    const unavailable: MediaRequest = async (url, init) => {
      if (init?.method === "PUT")
        throw new Error("Tracker validation timed out");
      return request(url, init);
    };
    await expect(
      runMediaSafety(credentials, true, unavailable),
    ).rejects.toThrow("indexer/1 request failed or timed out");
    expect(model.torrents).toHaveLength(0);
    expect(model.failed).toBe(true);
  });

  test("reconciles newly synced indexers and preserves unrelated fields", async () => {
    const writes: unknown[] = [];
    let value: number[] = [];
    const indexer = () => ({
      id: 3,
      fields: [
        { name: "failDownloads", value },
        { name: "apiKey", value: "unchanged" },
      ],
    });
    const request: MediaRequest = async (url, init) => {
      if (init?.method === "PUT") {
        if (typeof init.body !== "string")
          throw new TypeError("Expected JSON body");
        writes.push(JSON.parse(init.body));
        value = [0, 1];
        return Response.json({});
      }
      return Response.json(url.endsWith("indexer") ? [indexer()] : indexer());
    };
    const api = new MediaApi("http://fixture", {}, request);
    expect(await reconcileIndexerSafety(api, true)).toBe(1);
    expect(writes).toEqual([
      {
        id: 3,
        fields: [
          { name: "failDownloads", value: [0, 1] },
          { name: "apiKey", value: "unchanged" },
        ],
      },
    ]);
    expect(await reconcileIndexerSafety(api, true)).toBe(0);
  });
});

test.each([
  "/tv/file.exe",
  "/downloads/../tv/file.exe",
  "/downloads",
  "/downloads/sub/../../tv/file.exe",
])("rejects removal outside the downloads tree: %s", (contentPath) => {
  const { model, torrent } = fixture();
  expect(() =>
    assertRemovalPaths({ ...torrent, content_path: contentPath }, model.files),
  ).toThrow();
});
test.each([
  "../file.exe",
  "/file.exe",
  "folder/../file.exe",
  String.raw`folder\file.exe`,
])("rejects traversal in metadata: %s", (name) => {
  const { torrent } = fixture();
  expect(() => assertRemovalPaths(torrent, [{ name }])).toThrow();
});
test.each(["file.EXE", "file.mkv.exe", "folder.scr/episode.mkv", "script.ps1"])(
  "recognizes dangerous metadata: %s",
  (name) => expect(dangerousFiles([{ name }])).toHaveLength(1),
);
