import { expect, test } from "vitest";
import { TmdbClient } from "#integrations/tmdb.ts";

// Synthetic wire fixtures follow the documented TMDB v3 envelopes; they are not live acceptance evidence.
const group = {
  id: "group-fixture",
  name: "Absolute",
  type: 2,
  episode_count: 2,
  group_count: 1,
  groups: [
    {
      id: "subgroup-fixture",
      name: "Main",
      order: 7,
      locked: false,
      episodes: [
        {
          id: 801,
          show_id: 101,
          season_number: 0,
          episode_number: 1,
          order: 42,
        },
        {
          id: 802,
          show_id: 101,
          season_number: 1,
          episode_number: 1,
          order: 43,
        },
      ],
    },
  ],
};

test("normalizes movie/TV alias envelopes without discarding country/type or accepting wrong identity", async () => {
  const client = new TmdbClient(
    { kind: "api-key", apiKey: "fixture" },
    async (url) => {
      expect(url.searchParams.get("api_key")).toBe("fixture");
      const aliases = [
        { title: "Original alternative", iso_3166_1: "JP", type: "original" },
      ];
      return Response.json(
        url.pathname.includes("/movie/")
          ? { id: 101, titles: aliases }
          : { id: 101, results: aliases },
      );
    },
  );
  for (const kind of ["movie", "series"] as const)
    expect(await client.alternativeTitles(kind, 101)).toEqual({
      id: 101,
      titles: [
        { title: "Original alternative", country: "JP", type: "original" },
      ],
    });
  await expect(client.alternativeTitles("series", 102)).rejects.toThrow(
    "invalid-response",
  );
});

test("group adapters retain raw subgroup and episode orders and exact canonical IDs", async () => {
  const client = new TmdbClient(
    { kind: "bearer", token: "fixture" },
    async (url, init) => {
      expect(init.redirect).toBe("manual");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer fixture",
      );
      return Response.json(
        url.pathname.endsWith("episode_groups")
          ? {
              id: 101,
              results: [
                {
                  id: group.id,
                  name: group.name,
                  type: group.type,
                  episode_count: 2,
                  group_count: 1,
                },
              ],
            }
          : group,
      );
    },
  );
  expect(await client.episodeGroups(101)).toMatchObject({
    seriesId: 101,
    groups: [{ id: group.id, episodeCount: 2, groupCount: 1 }],
  });
  expect(await client.episodeGroup(group.id)).toMatchObject({
    groups: [
      {
        order: 7,
        episodes: [
          {
            id: 801,
            showId: 101,
            seasonNumber: 0,
            episodeNumber: 1,
            order: 42,
          },
          {
            id: 802,
            showId: 101,
            seasonNumber: 1,
            episodeNumber: 1,
            order: 43,
          },
        ],
      },
    ],
  });
  await expect(client.episodeGroup("../wrong")).rejects.toThrow();
  await expect(client.episodeGroup("different-group")).rejects.toThrow(
    "invalid-response",
  );
});

test("rejects oversized and malformed response bodies without leaking API keys", async () => {
  const oversized = new TmdbClient(
    { kind: "api-key", apiKey: "fixture-private" },
    () => Promise.resolve(new Response(" ".repeat(8 * 1024 * 1024 + 1))),
  );
  await expect(oversized.episodeGroup(group.id)).rejects.toThrow(
    "tmdb: invalid-response",
  );
  const failed = new TmdbClient(
    { kind: "api-key", apiKey: "fixture-private" },
    (url) => Promise.reject(new Error(url.href)),
  );
  await expect(failed.episodeGroup(group.id)).rejects.toThrow(
    /^tmdb: unavailable$/u,
  );
  const invalid = new TmdbClient({ kind: "bearer", token: "fixture" }, () =>
    Promise.resolve(new Response("invalid json")),
  );
  await expect(invalid.episodeGroup(group.id)).rejects.toThrow(
    /^tmdb: invalid-response$/u,
  );
});

test("bounds total episodes across all groups rather than only each subgroup", async () => {
  const episodes = Array.from({ length: 3000 }, (_, index) => ({
    id: index + 1,
    show_id: 101,
    season_number: 1,
    episode_number: index + 1,
    order: index,
  }));
  const client = new TmdbClient({ kind: "bearer", token: "fixture" }, () =>
    Promise.resolve(
      Response.json({
        ...group,
        episode_count: 5000,
        group_count: 2,
        groups: [
          { id: "one", name: "one", order: 1, locked: false, episodes },
          { id: "two", name: "two", order: 2, locked: false, episodes },
        ],
      }),
    ),
  );
  await expect(client.episodeGroup(group.id)).rejects.toThrow("total bound");
});
