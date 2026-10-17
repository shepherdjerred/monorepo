import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { createCatalogActivities } from "./catalog.ts";

const { database, context } = automationTestHarness();

test("series adoption queues bounded refresh with exact runtime and language evidence", async () => {
  let seasonCalls = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/tv/123"))
      return Response.json({
        id: 123,
        name: "Series",
        original_name: "Series",
        overview: "",
        first_air_date: "2020-01-01",
        poster_path: null,
        original_language: "ja",
        seasons: [
          { id: 100, season_number: 1, episode_count: 61, name: "Season 1" },
        ],
      });
    if (!url.pathname.endsWith("/tv/123/season/1"))
      throw new Error("Unexpected metadata endpoint");
    seasonCalls++;
    return Response.json({
      episodes: Array.from({ length: 61 }, (_, index) => ({
        id: index + 500,
        name: `Episode ${String(index + 1)}`,
        overview: "",
        season_number: 1,
        episode_number: index + 1,
        air_date: index === 0 ? null : "2021-02-03",
        runtime: index === 0 ? null : 24,
      })),
    });
  });
  const db = database();
  const adopted = await new TmdbCatalogApplication(db, ctx.tmdb).adopt(
    "series",
    123,
  );
  expect(seasonCalls).toBe(0);
  expect(await db.mediaItem.count({ where: { kind: "episode" } })).toBe(0);
  const existingSeason = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season",
      tmdbId: 100,
      parentId: adopted.mediaId,
      seasonNumber: 1,
    },
  });
  const identities = {
    tmdb: 501,
    seriesTmdb: 123,
    tvdb: 9001,
    plexRatingKey: "episode-key",
    plexSectionId: "2",
    absoluteNumber: 27,
    numberingEvidence: { source: "owner" },
  };
  await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Old episode title",
      tmdbId: 501,
      parentId: existingSeason.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: identities,
    },
  });
  const operation = await db.operation.findFirstOrThrow({
    where: { targetId: adopted.mediaId, kind: "refresh_catalog" },
  });
  const input = {
    mediaId: adopted.mediaId,
    operationId: operation.id,
    cursor: null,
  };
  const worker = createCatalogActivities(ctx);
  expect(await worker.refreshMediaCatalog(input)).toEqual({
    processed: 25,
    nextCursor: "0:25",
  });
  expect(await db.mediaItem.count({ where: { kind: "episode" } })).toBe(25);
  // Completion lost after commit: the database cursor resumes without refetch.
  expect(await worker.refreshMediaCatalog(input)).toEqual({
    processed: 25,
    nextCursor: "0:50",
  });
  expect(await worker.refreshMediaCatalog(input)).toEqual({
    processed: 11,
    nextCursor: "1:0",
  });
  expect(await worker.refreshMediaCatalog(input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  expect(seasonCalls).toBe(1);
  expect(
    await db.mediaItem.findUniqueOrThrow({
      where: { kind_tmdbId: { kind: "episode", tmdbId: 501 } },
    }),
  ).toMatchObject({ externalIds: identities });
  expect(
    await db.mediaItem.findUniqueOrThrow({
      where: { kind_tmdbId: { kind: "episode", tmdbId: 500 } },
    }),
  ).toMatchObject({
    runtimeMinutes: null,
    airDate: null,
    originalLanguage: "ja",
  });
  expect(
    await db.mediaItem.findUniqueOrThrow({
      where: { kind_tmdbId: { kind: "episode", tmdbId: 501 } },
    }),
  ).toMatchObject({ runtimeMinutes: 24, year: 2021, originalLanguage: "ja" });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: adopted.mediaId } }),
  ).toMatchObject({ catalogState: "ready" });
  expect(
    await db.operation.count({
      where: { targetId: adopted.mediaId, kind: "expand_catalog_requests" },
    }),
  ).toBe(1);
  await new TmdbCatalogApplication(db, ctx.tmdb).adopt("series", 123);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: adopted.mediaId } }),
  ).toMatchObject({ catalogState: "ready" });
  await db.mediaItem.update({
    where: { kind_tmdbId: { kind: "episode", tmdbId: 501 } },
    data: { externalIds: { ...identities, tmdb: 999 } },
  });
  const conflictingRefresh = await db.operation.create({
    data: { kind: "refresh_catalog", targetId: adopted.mediaId, payload: {} },
  });
  await expect(
    worker.refreshMediaCatalog({
      ...input,
      operationId: conflictingRefresh.id,
    }),
  ).rejects.toThrow("Catalog canonical identity conflicts");
  expect(
    await db.mediaItem.findUniqueOrThrow({
      where: { kind_tmdbId: { kind: "episode", tmdbId: 501 } },
    }),
  ).toMatchObject({ externalIds: { ...identities, tmdb: 999 } });
});
