import { expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createCatalogActivities } from "./catalog.ts";
import { createSweepActivities } from "#automation/sweeps.ts";

const harness = automationTestHarness();
const SIX_HOURS = 21_600_000;

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
      backdrop_path: null,
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

function movieCatalog(
  tmdbId: number,
  artwork: () => {
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
  },
) {
  return harness.context(async (url) => {
    if (url.pathname.endsWith("/alternative_titles"))
      return Response.json({ id: tmdbId, titles: [] });
    if (!url.pathname.endsWith(`/movie/${String(tmdbId)}`))
      throw new Error("Unexpected artwork request");
    return Response.json({
      id: tmdbId,
      title: "Artwork movie",
      original_title: "Artwork movie",
      release_date: "2020-01-01",
      original_language: "en",
      imdb_id: null,
      runtime: 100,
      ...artwork(),
    });
  });
}

/** A catalog refresh the way the outbox would start it for this title. */
async function refreshOnce(
  context: ReturnType<typeof harness.context>,
  mediaId: string,
) {
  const operation = await harness.database().operation.create({
    data: { kind: "refresh_catalog", targetId: mediaId, payload: { mediaId } },
  });
  return createCatalogActivities(context).refreshMediaCatalog({
    mediaId,
    operationId: operation.id,
    cursor: null,
  });
}

async function sweepDuePage() {
  await createSweepActivities(harness.context()).sweepMediaWork({
    kind: "due",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
}

/**
 * The refresh idempotency key names its six-hour period. Retiring the keys
 * already queued stands in for the next period arriving.
 */
async function nextSweepPeriod() {
  await harness.database()
    .$executeRaw`UPDATE "Operation" SET "idempotencyKey" = 'retired:' || id WHERE "idempotencyKey" LIKE 'calendar:%'`;
}

function refreshesQueued(mediaId: string) {
  return harness
    .database()
    .operation.count({ where: { targetId: mediaId, kind: "refresh_catalog" } });
}

/** Owned, but neither kept nor followed: the calendar alone never refreshes it. */
function unclaimedMovie(tmdbId: number, id?: string) {
  return harness.database().mediaItem.create({
    data: {
      ...(id === undefined ? {} : { id }),
      kind: "movie",
      title: "Artwork movie",
      tmdbId,
      intents: {
        create: {
          libraryKeep: false,
          desiredPresence: false,
          monitoring: false,
          generation: 0,
        },
      },
    },
  });
}

test("a movie refresh stores artwork, and a changed poster never advances the command version", async () => {
  const db = harness.database();
  const media = await unclaimedMovie(90_300);
  let artwork: ReturnType<Parameters<typeof movieCatalog>[1]> = {
    overview: "A synopsis.",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
  };
  const context = movieCatalog(90_300, () => artwork);
  await refreshOnce(context, media.id);
  const first = await db.mediaItem.findUniqueOrThrow({
    where: { id: media.id },
  });
  expect(first).toMatchObject({
    posterPath: "/poster.jpg",
    backdropPath: "/backdrop.jpg",
    overview: "A synopsis.",
    artworkObservedAt: expect.any(Date),
  });
  artwork = { overview: "", poster_path: "/new.jpg", backdrop_path: null };
  await refreshOnce(context, media.id);
  const second = await db.mediaItem.findUniqueOrThrow({
    where: { id: media.id },
  });
  expect(second).toMatchObject({
    posterPath: "/new.jpg",
    backdropPath: null,
    overview: null,
    version: first.version,
  });
  expect(second.artworkObservedAt?.getTime()).toBeGreaterThanOrEqual(
    first.artworkObservedAt?.getTime() ?? Number.NaN,
  );
});

test("an owned title nobody keeps or follows is refreshed each period until its artwork is observed, then left alone", async () => {
  const db = harness.database();
  const media = await unclaimedMovie(90_301);
  await sweepDuePage();
  await sweepDuePage();
  expect(await refreshesQueued(media.id)).toBe(1);
  // Still unobserved when the next period arrives: it is queued again.
  await nextSweepPeriod();
  await sweepDuePage();
  expect(await refreshesQueued(media.id)).toBe(2);
  // The catalog has no images or synopsis for this title. That is still an
  // observation, so the backfill ends instead of asking again every period.
  await refreshOnce(
    movieCatalog(90_301, () => ({
      overview: "",
      poster_path: null,
      backdrop_path: null,
    })),
    media.id,
  );
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
  ).toMatchObject({
    posterPath: null,
    backdropPath: null,
    overview: null,
    artworkObservedAt: expect.any(Date),
  });
  const queued = await refreshesQueued(media.id);
  await nextSweepPeriod();
  await sweepDuePage();
  expect(await refreshesQueued(media.id)).toBe(queued);
});

test("a first artwork backfill is bounded per page, never displaces a kept title, and titles that keep failing cannot hold the budget", async () => {
  const db = harness.database();
  // Everything earlier tests left behind has been observed.
  await db.mediaItem.updateMany({
    where: { artworkObservedAt: null },
    data: { artworkObservedAt: new Date() },
  });
  const backlog: { id: string }[] = [];
  for (let index = 0; index < 12; index++)
    backlog.push(
      await unclaimedMovie(
        91_000 + index,
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    );
  // Sorts after the whole backlog, so the page budget is spent before it.
  const kept = await db.mediaItem.create({
    data: {
      id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      kind: "movie",
      title: "Kept after the backlog",
      tmdbId: 91_100,
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
  expect(await db.mediaItem.count()).toBeLessThanOrEqual(50);
  // The budget's start rotates with the six-hour period. Begin at a period
  // whose turn starts at the first row of the page.
  const period = Math.ceil(Date.now() / SIX_HOURS / 5) * 5;
  const clock = vi.spyOn(Date, "now");
  const sweepIn = async (index: number) => {
    clock.mockReturnValue(index * SIX_HOURS + 1);
    await sweepDuePage();
    const queued = await db.operation.findMany({
      where: {
        kind: "refresh_catalog",
        idempotencyKey: { endsWith: `:${String(index)}` },
      },
      select: { targetId: true },
    });
    return new Set(queued.map((operation) => operation.targetId));
  };
  try {
    const first = await sweepIn(period);
    expect(backlog.filter((item) => first.has(item.id))).toEqual(
      backlog.slice(0, 10),
    );
    expect(first.has(kept.id)).toBe(true);
    // Not one of those ten refreshes succeeds, so all ten are still
    // unobserved. The two titles after them must still get their turn.
    const second = await sweepIn(period + 1);
    expect(backlog.filter((item) => second.has(item.id))).toEqual([
      ...backlog.slice(0, 8),
      ...backlog.slice(10),
    ]);
    expect(second.has(kept.id)).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
