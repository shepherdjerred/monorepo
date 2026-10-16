import { expect, test, vi } from "vitest";
import { runMediaSafety } from "./guard.ts";
import { credentials, isolationFixture } from "./guard.fixture.ts";
import type { MediaRequest } from "./client.ts";

test("a failed Sonarr candidate does not block later Sonarr or Radarr cleanup", async () => {
  const { records, request } = isolationFixture();
  const first = records[0];
  if (!first) throw new Error("Missing failed fixture");
  first.model.failBlocklist = true;
  const reported: string[] = [];
  await expect(
    runMediaSafety(credentials, true, request, (app) => reported.push(app)),
  ).rejects.toThrow("blocklist were not observed");
  expect(records.map(({ model }) => model.torrents.length)).toEqual([1, 0, 0]);
  expect(reported.toSorted()).toEqual(["radarr", "sonarr"]);
});

test("an unavailable Sonarr API does not prevent reachable Radarr cleanup", async () => {
  const { records, request } = isolationFixture();
  const unavailable: MediaRequest = (url, init) => {
    if (new URL(url).hostname.includes("sonarr"))
      throw new Error("Sonarr unavailable");
    return request(url, init);
  };
  const reported: string[] = [];
  await expect(
    runMediaSafety(credentials, true, unavailable, (app) => reported.push(app)),
  ).rejects.toThrow("sonarr torrent");
  expect(records.map(({ model }) => model.torrents.length)).toEqual([1, 1, 0]);
  expect(reported).toEqual(["radarr"]);
});

test("Radarr cleanup progresses while a Sonarr request is still stalled", async () => {
  const { records, request } = isolationFixture();
  const stalled = Promise.withResolvers<Response>();
  const pending: MediaRequest = (input, init) => {
    const url = new URL(input);
    return url.hostname.includes("sonarr") && url.pathname.endsWith("/history")
      ? stalled.promise
      : request(input, init);
  };
  const failure = expect(
    runMediaSafety(credentials, true, pending),
  ).rejects.toThrow("sonarr torrent");
  try {
    await vi.waitFor(() =>
      expect(
        records.find(({ app }) => app === "radarr")?.model.torrents,
      ).toEqual([]),
    );
  } finally {
    stalled.reject(new Error("Sonarr request timed out"));
    await failure;
  }
});

test("both indexer sets are attempted after independent content checks", async () => {
  const { records, request } = isolationFixture();
  for (const record of records) record.model.indexers[record.app] = [];
  const unavailable: MediaRequest = (url, init) => {
    if (new URL(url).hostname.includes("sonarr") && init?.method === "PUT")
      throw new Error("Sonarr validation unavailable");
    return request(url, init);
  };
  const reported: string[] = [];
  await expect(
    runMediaSafety(credentials, true, unavailable, (app) => reported.push(app)),
  ).rejects.toThrow("sonarr indexers");
  expect(records.map(({ model }) => model.torrents.length)).toEqual([0, 0, 0]);
  expect(reported.toSorted()).toEqual(["radarr", "sonarr", "sonarr"]);
  expect(
    records.find(({ app }) => app === "radarr")?.model.indexers.radarr,
  ).toEqual([0, 1]);
});

test("duplicate torrent identities fail before either application is mutated", async () => {
  const { records, request } = isolationFixture();
  const first = records[0];
  if (!first) throw new Error("Missing duplicate fixture");
  const duplicate: MediaRequest = (url, init) =>
    new URL(url).pathname.endsWith("torrents/info")
      ? Promise.resolve(Response.json([first.torrent, first.torrent]))
      : request(url, init);
  await expect(runMediaSafety(credentials, true, duplicate)).rejects.toThrow(
    "Duplicate media torrent hashes",
  );
  expect(records.flatMap(({ model }) => model.writes)).toEqual([]);
});
