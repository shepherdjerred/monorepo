import { expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { ARTWORK_ROOT_BACKFILL_PER_PERIOD as BUDGET } from "#domain/household/artwork-backfill.ts";

const harness = automationTestHarness();
const SIX_HOURS = 21_600_000;

type Answer = "art" | "bare" | "gone" | "down" | "unreadable" | "other-title";

/**
 * TMDB as the sweep sees it: each title answers the way the test says. Every
 * request is recorded, including one the test did not expect, because the
 * client reports a refused request as TMDB being unavailable.
 */
function tmdb(answers: ReadonlyMap<number, Answer>) {
  const reads: string[] = [];
  const context = harness.context(async (url) => {
    reads.push(url.pathname.replace("/3/", ""));
    const match = /\/3\/(movie|tv)\/(\d+)$/u.exec(url.pathname);
    const answer = answers.get(Number(match?.[2]));
    if (match === null || answer === undefined)
      throw new Error("Unexpected artwork request");
    const [, kind, id] = match;
    if (answer === "down") throw new Error("connection refused");
    if (answer === "gone")
      return Response.json({ status_code: 34 }, { status: 404 });
    if (answer === "unreadable") return Response.json({ id: "not a title" });
    const art =
      answer === "bare"
        ? { overview: "", poster_path: null, backdrop_path: null }
        : {
            overview: "A synopsis.",
            poster_path: `/poster-${String(id)}.jpg`,
            backdrop_path: `/backdrop-${String(id)}.jpg`,
          };
    const tmdbId = answer === "other-title" ? Number(id) + 1 : Number(id);
    return kind === "movie"
      ? Response.json({
          id: tmdbId,
          title: "Changed by TMDB",
          original_title: "Changed by TMDB",
          release_date: "1999-01-01",
          original_language: "fr",
          imdb_id: null,
          runtime: 1,
          ...art,
        })
      : Response.json({
          id: tmdbId,
          name: "Changed by TMDB",
          original_name: "Changed by TMDB",
          first_air_date: "1999-01-01",
          original_language: "fr",
          status: "Ended",
          seasons: [
            { id: 9_000_001, season_number: 1, episode_count: 9, name: "S1" },
          ],
          ...art,
        });
  });
  return { context, reads };
}

async function sweepDue(context: ReturnType<typeof harness.context>) {
  return createSweepActivities(context).sweepMediaWork({
    kind: "due",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
}

/** Leaves nothing from an earlier test waiting for the pass. */
async function observeEverything() {
  await harness.database().mediaItem.updateMany({
    where: { artworkObservedAt: null },
    data: { artworkObservedAt: new Date() },
  });
}

/** Everything the pass could have changed besides one root's artwork. */
async function footprint() {
  const db = harness.database();
  return {
    media: await db.mediaItem.count(),
    intents: await db.mediaIntent.count(),
    operations: await db.operation.count(),
    outbox: await db.outboxCommand.count(),
    releaseDates: await db.mediaReleaseDate.count(),
    editions: await db.mediaEditionDefinition.count(),
    events: await db.applicationEvent.count(),
  };
}

/** Films with no target, whose ids sort in the order they are returned. */
function untargetedMovies(count: number, firstTmdbId: number) {
  return harness.database().mediaItem.createManyAndReturn({
    data: Array.from({ length: count }, (_, index) => ({
      id: `${String(firstTmdbId).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`,
      kind: "movie" as const,
      title: `Imported film ${String(index)}`,
      tmdbId: firstTmdbId + index,
    })),
    select: { id: true, tmdbId: true },
  });
}

async function observedIds(roots: readonly { id: string }[]) {
  const rows = await harness.database().mediaItem.findMany({
    where: {
      id: { in: roots.map((root) => root.id) },
      artworkObservedAt: { not: null },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function observedCount(roots: readonly { id: string }[]) {
  const observed = await observedIds(roots);
  return observed.length;
}

test("a movie and a series without a default target have only their artwork observed, in one sweep", async () => {
  const db = harness.database();
  await observeEverything();
  const movie = await db.mediaItem.create({
    data: { kind: "movie", title: "Imported film", tmdbId: 70_001, year: 2020 },
  });
  // The household keeps this series' episodes, but the series itself was
  // never declared: the root has no target of its own.
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Migrated series",
      tmdbId: 70_002,
      catalogState: "ready",
      catalogCompletedAt: new Date("2026-11-12T00:00:00Z"),
      seriesStatus: "continuing",
    },
  });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Migrated series: Season 1",
      tmdbId: 70_003,
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Pilot",
      tmdbId: 70_004,
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
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
  const withoutIdentity = await db.mediaItem.create({
    data: { kind: "movie", title: "No TMDB identity" },
  });
  const observedAt = new Date("2026-11-01T00:00:00Z");
  const observed = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Already observed",
      tmdbId: 70_005,
      posterPath: "/kept.jpg",
      artworkObservedAt: observedAt,
    },
  });
  const before = await footprint();
  const { context, reads } = tmdb(
    new Map([
      [70_001, "art"],
      [70_002, "art"],
    ]),
  );
  await sweepDue(context);

  // One details read each: no alternative titles, external ids or seasons.
  expect(reads.toSorted()).toEqual(["movie/70001", "tv/70002"]);
  expect(await footprint()).toEqual(before);
  const after = (id: string) =>
    db.mediaItem.findUniqueOrThrow({ where: { id } });
  expect(await after(movie.id)).toMatchObject({
    posterPath: "/poster-70001.jpg",
    backdropPath: "/backdrop-70001.jpg",
    overview: "A synopsis.",
    artworkObservedAt: expect.any(Date),
    // Nothing else TMDB said was taken.
    title: movie.title,
    year: 2020,
    originalLanguage: null,
    runtimeMinutes: null,
    externalIds: {},
    availability: "wanted",
    version: movie.version,
  });
  expect(await after(series.id)).toMatchObject({
    posterPath: "/poster-70002.jpg",
    backdropPath: "/backdrop-70002.jpg",
    overview: "A synopsis.",
    artworkObservedAt: expect.any(Date),
    title: series.title,
    year: null,
    seriesStatus: "continuing",
    seriesStatusObservedAt: null,
    catalogState: "ready",
    catalogCompletedAt: series.catalogCompletedAt,
    externalIds: {},
    version: series.version,
  });
  expect(await after(season.id)).toEqual(season);
  expect(await after(episode.id)).toEqual(episode);
  expect(await after(withoutIdentity.id)).toEqual(withoutIdentity);
  expect(await after(observed.id)).toEqual(observed);

  // Observed once: the next period has nothing to ask.
  await sweepDue(context);
  expect(reads).toHaveLength(2);
});

test("a root with a default target is left to refresh_catalog", async () => {
  const db = harness.database();
  await observeEverything();
  const targeted = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Owned film",
      tmdbId: 70_100,
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
  const { context, reads } = tmdb(new Map());
  await sweepDue(context);
  expect(reads).toEqual([]);
  expect(
    await db.operation.count({
      where: { targetId: targeted.id, kind: "refresh_catalog" },
    }),
  ).toBe(1);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: targeted.id } }),
  ).toMatchObject({ artworkObservedAt: null });
});

test("TMDB having no images is an observation; TMDB failing for a title is not, and neither fails the sweep", async () => {
  const db = harness.database();
  await observeEverything();
  const answers = new Map<number, Answer>([
    [70_200, "bare"],
    [70_201, "gone"],
    [70_202, "down"],
    [70_203, "unreadable"],
    [70_204, "other-title"],
    [70_205, "art"],
  ]);
  const roots = await db.mediaItem.createManyAndReturn({
    data: [...answers.keys()].map((tmdbId) => ({
      kind: tmdbId % 2 === 0 ? ("movie" as const) : ("series" as const),
      title: `Root ${String(tmdbId)}`,
      tmdbId,
    })),
  });
  const before = await footprint();
  const { context, reads } = tmdb(answers);
  const rawLogs: string[] = [];
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((line) => {
    rawLogs.push(String(line));
  });
  try {
    await expect(sweepDue(context)).resolves.toBeDefined();
    expect(reads).toHaveLength(6);
    expect(await footprint()).toEqual(before);
    const rows = await db.mediaItem.findMany({
      where: { id: { in: roots.map((root) => root.id) } },
      orderBy: { tmdbId: "asc" },
    });
    expect(
      rows.map((row) => [row.tmdbId, row.artworkObservedAt !== null]),
    ).toEqual([
      [70_200, true],
      [70_201, false],
      [70_202, false],
      [70_203, false],
      [70_204, false],
      [70_205, true],
    ]);
    expect(rows[0]).toMatchObject({
      posterPath: null,
      backdropPath: null,
      overview: null,
    });
    for (const line of rawLogs) {
      expect(line).not.toContain("http://");
      expect(line).not.toContain("https://");
      expect(line).not.toContain("Bearer");
    }
    const logged = rawLogs
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "media.root_artwork.tmdb_failed")
      .sort((a, b) => a.tmdbId - b.tmdbId);
    expect(logged).toEqual([
      {
        level: "warn",
        event: "media.root_artwork.tmdb_failed",
        mediaId: rows[1]?.id,
        mediaKind: "series",
        tmdbId: 70_201,
        failureKind: "unavailable",
        status: 404,
        reason: "upstream_tmdb_error",
      },
      {
        level: "warn",
        event: "media.root_artwork.tmdb_failed",
        mediaId: rows[2]?.id,
        mediaKind: "movie",
        tmdbId: 70_202,
        failureKind: "unavailable",
        status: null,
        reason: "upstream_tmdb_error",
      },
      {
        level: "warn",
        event: "media.root_artwork.tmdb_failed",
        mediaId: rows[3]?.id,
        mediaKind: "series",
        tmdbId: 70_203,
        failureKind: "invalid-response",
        status: null,
        reason: "upstream_tmdb_error",
      },
      {
        level: "warn",
        event: "media.root_artwork.tmdb_failed",
        mediaId: rows[4]?.id,
        mediaKind: "movie",
        tmdbId: 70_204,
        failureKind: "invalid-response",
        status: null,
        reason: "id_mismatch",
      },
    ]);
    // The four failures are still waiting, and are asked about again.
    await sweepDue(context);
    expect(reads).toHaveLength(10);
    expect(await db.operation.count({ where: { status: "failed" } })).toBe(0);
  } finally {
    warnSpy.mockRestore();
  }
});

test("a corrupt TMDB identity is a broken contract and fails the sweep", async () => {
  const db = harness.database();
  await observeEverything();
  const corrupt = await db.mediaItem.create({
    data: { kind: "movie", title: "Corrupt identity", tmdbId: -1 },
  });
  await expect(sweepDue(tmdb(new Map()).context)).rejects.toThrow();
  await db.mediaItem.delete({ where: { id: corrupt.id } });
});

test("a backlog is observed 25 a period in ceil(count / 25) periods, and a re-run asks only about what still waits", async () => {
  await observeEverything();
  const backlog = await untargetedMovies(60, 71_000);
  const answers = new Map<number, Answer>(
    backlog.map((root) => [Number(root.tmdbId), "art"]),
  );
  const { context, reads } = tmdb(answers);
  const clock = vi.spyOn(Date, "now");
  try {
    const period = Math.floor(Date.now() / SIX_HOURS) + 10;
    let periods = 0;
    for (
      let waiting = backlog.length;
      waiting > 0;
      waiting = backlog.length - (await observedCount(backlog))
    ) {
      clock.mockReturnValue((period + periods) * SIX_HOURS + 1);
      const asked = reads.length;
      await sweepDue(context);
      expect(reads.length - asked).toBe(Math.min(BUDGET, waiting));
      periods++;
    }
    expect(periods).toBe(Math.ceil(backlog.length / BUDGET));
    // No title was asked about twice, and none was missed.
    expect(reads).toHaveLength(backlog.length);
    expect(new Set(reads).size).toBe(backlog.length);

    // The same period again, as an Activity retry or a manual run would be:
    // the bound holds for that run too, and nothing observed is asked again.
    const more = await untargetedMovies(30, 71_500);
    for (const root of more) answers.set(Number(root.tmdbId), "art");
    clock.mockReturnValue((period + periods) * SIX_HOURS + 1);
    await sweepDue(context);
    expect(reads).toHaveLength(backlog.length + BUDGET);
    await sweepDue(context);
    expect(reads).toHaveLength(backlog.length + more.length);
    expect(new Set(reads).size).toBe(backlog.length + more.length);
  } finally {
    clock.mockRestore();
  }
});

test("more failing roots than the budget are retried in turn and cannot keep the others from being observed", async () => {
  await observeEverything();
  const backlog = await untargetedMovies(70, 72_000);
  // The first 40 in id order never get an answer; 40 is more than one period's
  // budget, so a pass that always started at the front would never get past them.
  const failing = backlog.slice(0, 40);
  const healthy = backlog.slice(40);
  const { context, reads } = tmdb(
    new Map<number, Answer>([
      ...failing.map((root) => [Number(root.tmdbId), "gone"] as const),
      ...healthy.map((root) => [Number(root.tmdbId), "art"] as const),
    ]),
  );
  const clock = vi.spyOn(Date, "now");
  try {
    const period = Math.floor(Date.now() / SIX_HOURS) + 10;
    const bound = Math.ceil(backlog.length / BUDGET);
    let periods = 0;
    let sinceProgress = 0;
    for (let observed = 0; observed < healthy.length;) {
      clock.mockReturnValue((period + periods) * SIX_HOURS + 1);
      const asked = reads.length;
      await sweepDue(context);
      expect(reads.length - asked).toBe(BUDGET);
      periods++;
      const now = await observedCount(backlog);
      sinceProgress = now === observed ? sinceProgress + 1 : 0;
      observed = now;
      // While nothing changes the windows cover the ring, so a healthy root
      // is always reached before the failures have gone all the way round.
      expect(sinceProgress).toBeLessThan(bound);
    }
    expect(await observedIds(backlog)).toEqual(healthy.map((root) => root.id));
    // Only the failures are left. They keep their turns: all 40 are asked
    // about again within ceil(40 / 25) periods, 25 at a time.
    const asked = reads.length;
    for (let index = 0; index < Math.ceil(failing.length / BUDGET); index++) {
      clock.mockReturnValue((period + periods + index) * SIX_HOURS + 1);
      await sweepDue(context);
    }
    expect(reads.length - asked).toBe(2 * BUDGET);
    expect(new Set(reads.slice(asked))).toEqual(
      new Set(failing.map((root) => `movie/${String(root.tmdbId)}`)),
    );
    expect(await observedIds(backlog)).toEqual(healthy.map((root) => root.id));
  } finally {
    clock.mockRestore();
  }
});
