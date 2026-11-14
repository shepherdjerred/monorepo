import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createCatalogActivities } from "./catalog.ts";
import { createSweepActivities } from "#automation/sweeps.ts";

const harness = automationTestHarness();

test("movie calendar refresh is retry-safe information only and preserves passive file authority", async () => {
  const db = harness.database();
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Calendar movie",
      tmdbId: 90_210,
      year: 2026,
      intents: {
        create: {
          libraryKeep: true,
          desiredPresence: false,
          monitoring: false,
          generation: 0,
        },
      },
    },
  });
  const targetBefore = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
  });
  let movieCalls = 0;
  const context = harness.context(async (url) => {
    if (url.pathname.endsWith("/alternative_titles"))
      return Response.json({ id: 90_210, titles: [] });
    if (!url.pathname.endsWith("/movie/90210"))
      throw new Error("Unexpected calendar request");
    expect(url.searchParams.get("append_to_response")).toBe("release_dates");
    movieCalls++;
    return Response.json({
      id: 90_210,
      title: media.title,
      original_title: media.title,
      overview: "",
      release_date: "2026-11-13",
      poster_path: null,
      original_language: "en",
      imdb_id: null,
      runtime: 100,
      release_dates: {
        results: [
          {
            iso_3166_1: "US",
            release_dates: [{ type: 4, release_date: "2026-11-13T00:00:00Z" }],
          },
        ],
      },
    });
  });
  const operation = await db.operation.create({
    data: {
      kind: "refresh_catalog",
      targetId: media.id,
      payload: { mediaId: media.id },
    },
  });
  const activities = createCatalogActivities(context);
  const input = { mediaId: media.id, operationId: operation.id, cursor: null };
  expect(await activities.refreshMediaCatalog(input)).toEqual({
    processed: 1,
    nextCursor: null,
  });
  expect(await activities.refreshMediaCatalog(input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  expect(movieCalls).toBe(1);
  expect(
    await db.mediaReleaseDate.findMany({
      where: { mediaId: media.id, kind: "digital" },
    }),
  ).toMatchObject([{ date: "2026-11-13", region: "US", precision: "day" }]);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    }),
  ).toEqual(targetBefore);
  expect(
    await db.libraryAsset.count({
      where: { coverage: { some: { mediaId: media.id } } },
    }),
  ).toBe(0);
});

test("a passive kept movie receives bounded calendar refresh without acquisition or monitoring", async () => {
  const db = harness.database();
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Passive kept title",
      tmdbId: 90_211,
      intents: {
        create: {
          libraryKeep: true,
          desiredPresence: false,
          monitoring: false,
          generation: 0,
        },
      },
    },
  });
  const activities = createSweepActivities(harness.context());
  const input = {
    kind: "due" as const,
    cursor: null,
    sweepId: crypto.randomUUID(),
  };
  await activities.sweepMediaWork(input);
  await activities.sweepMediaWork(input);
  expect(
    await db.operation.count({
      where: {
        targetId: media.id,
        kind: "refresh_catalog",
        idempotencyKey: { startsWith: "calendar:" },
      },
    }),
  ).toBe(1);
  expect(
    await db.operation.count({
      where: {
        targetId: media.id,
        kind: { in: ["reconcile_media", "acquire_release"] },
      },
    }),
  ).toBe(0);
});
