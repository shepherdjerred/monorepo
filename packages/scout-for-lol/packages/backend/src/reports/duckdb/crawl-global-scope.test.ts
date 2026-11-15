import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { isCrawlOnlyMatch } from "#src/explore/analysis/crawled-match.ts";
import { foldCrawlInbox } from "#src/report-lake/crawl/crawl-fold.ts";
import { writeCrawlInboxSegment } from "#src/report-lake/crawl/crawl-inbox.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { compileScoutQlPlanQuery } from "#src/reports/duckdb/compile-plan.ts";
import { ALL_POPULATION } from "#src/reports/duckdb/lake/all-population.ts";
import { resolveLakeFiles, type LakeFiles } from "#src/reports/duckdb/lake.ts";
import { replaceCrawlTombstoneSourceForTests } from "#src/reports/duckdb/lake/crawl-tombstones.ts";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import {
  CRAWL_SCAN_BUDGET_BYTES,
  ScanBudgetExceededError,
} from "#src/reports/duckdb/plan-budget.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import {
  crawlFixturePuuids,
  crawlSegment,
} from "#src/testing/report-lake/crawl-segments.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import {
  COUNT_OUTPUT,
  eq,
  number_,
  runPlan,
} from "#src/testing/run-compiled-plan.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * Global-scope reads over the `all` population, DuckDB only, against a temp
 * lake: a tracked build with crawl tables folded into it.
 *
 * The crawled segment holds two games. NA1_8000000001 is also tracked (the
 * tracked lake has one of its players), so the tracked copy must win and the
 * crawled one must not be counted again; NA1_8000000003 exists only in the
 * crawl.
 */

const SERVER_ID = testGuildId("8842");
const CREATED = new Date(Date.UTC(2026, 1, 7, 12));
const INGEST_DAY = "2026-02-20";
const RANGE = {
  start: new Date(Date.UTC(2026, 0, 1)),
  end: new Date(Date.UTC(2026, 2, 1)),
};
const SHARED = "NA1_8000000001";
const CRAWL_ONLY = "NA1_8000000003";

let lakeDir: string;
let before: LakeFiles;
let files: LakeFiles;
/** What `ErasedPuuid` would hold with `lakeErasedAt` null; empty but for the tombstone tests. */
let tombstones: string[] = [];
let restoreTombstones: () => void;

function plan(overrides: Partial<ScoutQlPlan> = {}): ScoutQlPlan {
  return {
    source: "match_participants",
    outputs: [COUNT_OUTPUT],
    timeWindow: { kind: "unbounded" },
    groupings: [],
    orderBy: [],
    limit: 100,
    playerRefs: [],
    render: DEFAULT_RENDER_SPEC,
    ...overrides,
  };
}

const BY_PROVENANCE = plan({
  groupings: [{ kind: "column", column: "provenance", name: "provenance" }],
  orderBy: [{ target: { kind: "grouping", index: 0 }, direction: "asc" }],
});
const BY_MATCH = plan({
  groupings: [{ kind: "column", column: "match_id", name: "match" }],
  orderBy: [{ target: { kind: "grouping", index: 0 }, direction: "asc" }],
});

beforeAll(async () => {
  restoreTombstones = replaceCrawlTombstoneSourceForTests(() =>
    Promise.resolve(tombstones),
  );
  lakeDir = await mkdtemp(path.join(tmpdir(), "crawl-global-scope-"));
  const [, sharedPuuid] = await crawlFixturePuuids();
  if (sharedPuuid === undefined) throw new Error("fixture has no players");
  const fact = {
    queue: "solo",
    win: true,
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    gameCreationAt: CREATED,
  };
  await writeTestLake(lakeDir, {
    serverId: SERVER_ID,
    matchFacts: [
      {
        ...fact,
        playerId: 1,
        playerAlias: "Shared",
        matchId: RiotMatchIdSchema.parse(SHARED),
        puuid: LeaguePuuidSchema.parse(sharedPuuid),
      },
      {
        ...fact,
        playerId: 2,
        playerAlias: "Tracked",
        matchId: RiotMatchIdSchema.parse("NA1_8000000002"),
        puuid: testPuuid("8842"),
      },
    ],
  });
  before = await resolveLakeFiles(lakeDir);
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) throw new Error("test lake has no build");
  await writeCrawlInboxSegment(
    lakeDir,
    await crawlSegment(INGEST_DAY, [SHARED, CRAWL_ONLY]),
  );
  await foldCrawlInbox({
    lakeDir,
    buildDir,
    buildId: "crawl",
    loadErased: () => Promise.resolve(new Set<string>()),
    now: new Date(`${INGEST_DAY}T12:00:00.000Z`),
  });
  files = await resolveLakeFiles(lakeDir);
});

afterAll(async () => {
  restoreTombstones();
  await rm(lakeDir, { recursive: true, force: true });
});

function counts(rows: Record<string, unknown>[]): [unknown, number][] {
  return rows.map((row) => [row["__key_0"], number_(row["expr_0"])]);
}

describe("global scope over the all population", () => {
  test("unions crawl rows by name, and a tracked match always wins", async () => {
    const { rows } = await runPlan({
      plan: BY_PROVENANCE,
      scope: GLOBAL_SCOPE,
      files,
      range: RANGE,
      limit: 100,
      population: ALL_POPULATION,
    });
    // Two tracked participant rows; ten from the crawl-only game. The shared
    // game's ten crawled rows are not read back.
    expect(counts(rows)).toEqual([
      ["crawl", 10],
      ["tracked", 2],
    ]);

    const byMatch = await runPlan({
      plan: BY_MATCH,
      scope: GLOBAL_SCOPE,
      files,
      range: RANGE,
      limit: 100,
      population: ALL_POPULATION,
    });
    expect(counts(byMatch.rows)).toEqual([
      [SHARED, 1],
      ["NA1_8000000002", 1],
      [CRAWL_ONLY, 10],
    ]);
  });

  test("reads the crawl with no dedupe window, anti-joined on tracked match ids", () => {
    const compiled = compileScoutQlPlanQuery({
      plan: plan(),
      scope: GLOBAL_SCOPE,
      files,
      range: RANGE,
      limit: 100,
      population: ALL_POPULATION,
    });
    const sql = compiled?.aggregateSql ?? "";
    const crawlBranch = sql.slice(sql.indexOf("'crawl' AS provenance"));
    expect(crawlBranch.length).toBeLessThan(sql.length);
    expect(crawlBranch.split("ANTI JOIN")[0]).not.toMatch(
      /row_number|QUALIFY/u,
    );
    expect(crawlBranch).toContain("ANTI JOIN");
  });

  test("the tracked population is byte-identical to the lake before the crawl", async () => {
    for (const scope of [GLOBAL_SCOPE, guildScope(SERVER_ID)]) {
      const withCrawl = await runPlan({
        plan: BY_MATCH,
        scope,
        files,
        range: RANGE,
        limit: 100,
      });
      const withoutCrawl = await runPlan({
        plan: BY_MATCH,
        scope,
        files: before,
        range: RANGE,
        limit: 100,
      });
      expect(withCrawl.compiled.aggregateSql).toBe(
        withoutCrawl.compiled.aggregateSql,
      );
      expect(withCrawl.compiled.aggregateParams).toEqual(
        withoutCrawl.compiled.aggregateParams,
      );
      expect(JSON.stringify(withCrawl.rows, bigints)).toBe(
        JSON.stringify(withoutCrawl.rows, bigints),
      );
    }
  });

  test("provenance reads 'tracked' in a server's scope", async () => {
    const { rows } = await runPlan({
      plan: BY_PROVENANCE,
      scope: guildScope(SERVER_ID),
      files,
      range: RANGE,
      limit: 100,
    });
    expect(counts(rows)).toEqual([["tracked", 2]]);
  });

  test("a server scope refuses the crawl population", () => {
    expect(() =>
      compileScoutQlPlanQuery({
        plan: plan(),
        scope: guildScope(SERVER_ID),
        files,
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      }),
    ).toThrow(/global-only/u);
  });

  test("prunes crawl days that cannot hold a game in the window", () => {
    const compiled = compileScoutQlPlanQuery({
      plan: plan(),
      scope: GLOBAL_SCOPE,
      files,
      // The crawled games were played in February; a game created in
      // December could only be on a crawl day up to late January.
      range: {
        start: new Date(Date.UTC(2025, 11, 1)),
        end: new Date(Date.UTC(2025, 11, 31)),
      },
      limit: 100,
      population: ALL_POPULATION,
    });
    expect(compiled?.aggregateSql).not.toContain("'crawl' AS provenance");
  });

  test("joins crawled timelines only for an item or skill event filter", () => {
    const events = (where?: ScoutQlPlan["where"]) =>
      compileScoutQlPlanQuery({
        plan: plan({
          source: "timeline_events",
          ...(where === undefined ? {} : { where }),
        }),
        scope: GLOBAL_SCOPE,
        files,
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      })?.aggregateSql ?? "";
    const crawlEvents = files.crawl.timelineEvents[0]?.path;
    expect(crawlEvents).toBeDefined();
    expect(events()).not.toContain("'crawl' AS provenance");
    expect(events(eq("event_type", "CHAMPION_KILL"))).not.toContain(
      "'crawl' AS provenance",
    );
    expect(events(eq("event_type", "ITEM_PURCHASED"))).toContain(
      "'crawl' AS provenance",
    );
  });
});

/** The real lake's files, with one crawl match file of a given size and day. */
function withMatchBytes(bytes: number, ingestDay = INGEST_DAY): LakeFiles {
  return {
    ...files,
    crawl: {
      ...files.crawl,
      matches: [{ path: "/lake/matches_crawl/huge.parquet", ingestDay, bytes }],
    },
  };
}

describe("the crawl scan budget", () => {
  test("refuses a global query whose crawl scan is over budget, before any I/O", () => {
    expect(() =>
      compileScoutQlPlanQuery({
        plan: plan(),
        scope: GLOBAL_SCOPE,
        files: withMatchBytes(CRAWL_SCAN_BUDGET_BYTES + 1),
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      }),
    ).toThrow(ScanBudgetExceededError);
  });

  test("counts only the days left after pruning, and never a tracked read", () => {
    const huge = withMatchBytes(CRAWL_SCAN_BUDGET_BYTES * 4, "2025-06-01");
    expect(
      compileScoutQlPlanQuery({
        plan: plan(),
        scope: GLOBAL_SCOPE,
        files: huge,
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      }),
    ).toBeDefined();
    expect(
      compileScoutQlPlanQuery({
        plan: plan(),
        scope: GLOBAL_SCOPE,
        files: withMatchBytes(CRAWL_SCAN_BUDGET_BYTES * 4),
        range: RANGE,
        limit: 100,
      }),
    ).toBeDefined();
  });
});

describe("erasure tombstones", () => {
  test("hide every crawled match naming an erased player before any file is rewritten", async () => {
    const [erasedPuuid] = await crawlFixturePuuids();
    if (erasedPuuid === undefined) throw new Error("fixture has no players");
    const filesBefore = files.crawl.matches.map((file) => file.path);
    tombstones = [puuidHash(erasedPuuid)];
    try {
      const tombstoned = await resolveLakeFiles(lakeDir);
      expect(tombstoned.crawlTombstones).toEqual(tombstones);
      // The same crawl files are read; the query drops the matches.
      expect(tombstoned.crawl.matches.map((file) => file.path)).toEqual(
        filesBefore,
      );
      const { rows } = await runPlan({
        plan: BY_MATCH,
        scope: GLOBAL_SCOPE,
        files: tombstoned,
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      });
      // Both crawled games name the player: the crawl-only one is gone, and
      // the tracked copy of the shared game is not crawl data and stays.
      expect(counts(rows)).toEqual([
        [SHARED, 1],
        ["NA1_8000000002", 1],
      ]);
      const identities = await resolvePlayerIdentities({
        query: "NightHeight#EUW",
        guildIds: [SERVER_ID],
        lakeDir,
        population: ALL_POPULATION,
      });
      expect(identities).toEqual([]);
    } finally {
      tombstones = [];
    }
  });

  test("a tombstone for a player the crawl never stored changes nothing", async () => {
    tombstones = [puuidHash("not-a-crawled-player".padEnd(78, "0"))];
    try {
      const { rows } = await runPlan({
        plan: BY_MATCH,
        scope: GLOBAL_SCOPE,
        files: await resolveLakeFiles(lakeDir),
        range: RANGE,
        limit: 100,
        population: ALL_POPULATION,
      });
      expect(counts(rows)).toEqual([
        [SHARED, 1],
        ["NA1_8000000002", 1],
        [CRAWL_ONLY, 10],
      ]);
    } finally {
      tombstones = [];
    }
  });

  test("tracked reads never consult tombstones", async () => {
    tombstones = [puuidHash(testPuuid("8842"))];
    try {
      const tracked = await runPlan({
        plan: BY_MATCH,
        scope: GLOBAL_SCOPE,
        files: await resolveLakeFiles(lakeDir),
        range: RANGE,
        limit: 100,
      });
      expect(counts(tracked.rows)).toEqual([
        [SHARED, 1],
        ["NA1_8000000002", 1],
      ]);
    } finally {
      tombstones = [];
    }
  });
});

describe("identity and review over the crawl", () => {
  test("a crawled player's Riot ID resolves only for the all population", async () => {
    const tracked = await resolvePlayerIdentities({
      query: "NightHeight#EUW",
      guildIds: [SERVER_ID],
      lakeDir,
    });
    expect(tracked).toEqual([]);
    const all = await resolvePlayerIdentities({
      query: "NightHeight#EUW",
      guildIds: [SERVER_ID],
      lakeDir,
      population: ALL_POPULATION,
    });
    expect(all.map((identity) => identity.games)).toEqual([1]);
    expect(all[0]?.matchedBy).toBe("riot_id");
  });

  test("tells a crawled game from a tracked one for review_match", async () => {
    await expect(
      isCrawlOnlyMatch({
        matchId: RiotMatchIdSchema.parse(CRAWL_ONLY),
        lakeDir,
      }),
    ).resolves.toBe(true);
    await expect(
      isCrawlOnlyMatch({ matchId: RiotMatchIdSchema.parse(SHARED), lakeDir }),
    ).resolves.toBe(false);
  });
});

function bigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}
