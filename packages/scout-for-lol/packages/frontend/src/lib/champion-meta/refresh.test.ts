import { describe, expect, test } from "vitest";
import { BASE_MANIFEST } from "./__fixtures__/manifest-base.ts";
import fixture from "./__fixtures__/champion-meta.fixture.json";
import { buildChampionMetaSnapshot, type FetchLike } from "./refresh.ts";
import { EMPTY_CHAMPION_META_SNAPSHOT } from "./snapshot.ts";

const ORIGIN = "https://meta.test";

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

function apiError(status: number, code: string, headers: HeadersInit = {}) {
  return json({ error: { code, message: code } }, { status, headers });
}

const MANIFEST = {
  ...BASE_MANIFEST,
  champions: [
    { id: 145, name: "Kai'Sa" },
    { id: 103, name: "Ahri" },
    { id: 777, name: "Below Floor" },
  ],
  caveats: ["Counts come from the crawl."],
};

function championBody(id: number) {
  const champion = fixture.champions.find((entry) => entry.id === id);
  if (champion === undefined)
    throw new Error(`no fixture for ${id.toString()}`);
  return {
    schemaVersion: 1,
    buildId: "build-1",
    championId: champion.id,
    championName: champion.name,
    slices: champion.slices,
  };
}

function serve(
  routes: Record<string, () => Response>,
  requested: string[] = [],
): FetchLike {
  return async (url) => {
    requested.push(url);
    const path = url.slice(ORIGIN.length);
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected request ${url}`);
    return route();
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe("buildChampionMetaSnapshot", () => {
  test("is the empty snapshot while the API has published nothing", async () => {
    const snapshot = await buildChampionMetaSnapshot({
      origin: ORIGIN,
      fetch: serve({
        "/api/meta/v1/manifest": () => apiError(503, "meta_unavailable"),
      }),
      sleep: noSleep,
    });
    expect(snapshot).toEqual(EMPTY_CHAMPION_META_SNAPSHOT);
  });

  test("is empty when no slice meets the sample floor", async () => {
    const snapshot = await buildChampionMetaSnapshot({
      origin: ORIGIN,
      fetch: serve({
        "/api/meta/v1/manifest": () =>
          json({ ...MANIFEST, defaults: null, champions: [] }),
      }),
      sleep: noSleep,
    });
    expect(snapshot.champions).toEqual([]);
  });

  test("fetches one consistent slice and drops champions the API withholds", async () => {
    const requested: string[] = [];
    const query = "patch=16.3&queue=420&bracket=all";
    const snapshot = await buildChampionMetaSnapshot({
      origin: `${ORIGIN}/`,
      fetch: serve(
        {
          "/api/meta/v1/manifest": () => json(MANIFEST),
          [`/api/meta/v1/champions/103?${query}`]: () =>
            json(championBody(103)),
          [`/api/meta/v1/champions/145?${query}`]: () =>
            json(championBody(145)),
          [`/api/meta/v1/champions/777?${query}`]: () =>
            apiError(404, "slice_not_found"),
        },
        requested,
      ),
      sleep: noSleep,
    });
    expect(snapshot.champions.map((champion) => champion.slug)).toEqual([
      "ahri",
      "kaisa",
    ]);
    expect(snapshot.source).toMatchObject({
      buildId: "build-1",
      generatedAt: "2026-01-08T00:00:00.000Z",
      minSliceGames: 100,
    });
    expect(snapshot.caveats).toEqual(["Counts come from the crawl."]);
    expect(requested).toHaveLength(4);
  });

  test("waits out a rate limit and retries", async () => {
    const waits: number[] = [];
    let limited = true;
    const query = "patch=16.3&queue=420&bracket=all";
    const snapshot = await buildChampionMetaSnapshot({
      origin: ORIGIN,
      fetch: serve({
        "/api/meta/v1/manifest": () =>
          json({ ...MANIFEST, champions: [{ id: 103, name: "Ahri" }] }),
        [`/api/meta/v1/champions/103?${query}`]: () => {
          if (!limited) return json(championBody(103));
          limited = false;
          return apiError(429, "rate_limited", { "Retry-After": "7" });
        },
      }),
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    expect(waits).toEqual([7000]);
    expect(snapshot.champions).toHaveLength(1);
  });

  test("rejects a champion served from a different build than the manifest", async () => {
    const query = "patch=16.3&queue=420&bracket=all";
    await expect(
      buildChampionMetaSnapshot({
        origin: ORIGIN,
        fetch: serve({
          "/api/meta/v1/manifest": () =>
            json({ ...MANIFEST, champions: [{ id: 103, name: "Ahri" }] }),
          [`/api/meta/v1/champions/103?${query}`]: () =>
            json({ ...championBody(103), buildId: "build-2" }),
        }),
        sleep: noSleep,
      }),
    ).rejects.toThrow(/build changed/u);
  });

  test("fails loudly on an unexpected API answer", async () => {
    await expect(
      buildChampionMetaSnapshot({
        origin: ORIGIN,
        fetch: serve({
          "/api/meta/v1/manifest": () => apiError(500, "internal"),
        }),
        sleep: noSleep,
      }),
    ).rejects.toThrow(/500/u);
  });

  test("fails loudly when the manifest breaks its contract", async () => {
    await expect(
      buildChampionMetaSnapshot({
        origin: ORIGIN,
        fetch: serve({ "/api/meta/v1/manifest": () => json({ nope: true }) }),
        sleep: noSleep,
      }),
    ).rejects.toThrow();
  });
});
