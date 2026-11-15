import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { foldCrawlInbox } from "#src/report-lake/crawl/crawl-fold.ts";
import { writeCrawlInboxSegment } from "#src/report-lake/crawl/crawl-inbox.ts";
import {
  lakeSchemaFingerprint,
  LAKE_TABLE_COLUMNS,
} from "#src/report-lake/schema.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import { resolveLakeFiles, type LakeFiles } from "#src/reports/duckdb/lake.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import {
  crawlFixturePuuids,
  crawlSegment,
} from "#src/testing/report-lake/crawl-segments.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import { COUNT_OUTPUT, runPlan } from "#src/testing/run-compiled-plan.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * Crawl tables live in the same build as the tracked tables, but nothing
 * reads them unless it asks for the `all` population. So every tracked read —
 * guild scope, global scope, identity resolution — answers byte-for-byte the
 * same before and after crawl files appear, and the tracked schema
 * fingerprint does not move.
 *
 * The tracked lake deliberately tracks one of the crawled match's players, so
 * a crawl row leaking into a tracked read would change a count.
 */

const SERVER_ID = testGuildId("8841");
const CREATED = new Date(Date.UTC(2026, 1, 7, 12));
let lakeDir: string;

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

/** Every tracked read under test, serialized exactly. */
async function trackedAnswers(files: LakeFiles): Promise<string> {
  const range = {
    start: new Date(Date.UTC(2020, 0, 1)),
    end: new Date(Date.UTC(2030, 0, 1)),
  };
  const byChampion = plan({
    groupings: [{ kind: "column", column: "champion_name", name: "champion" }],
    orderBy: [{ target: { kind: "grouping", index: 0 }, direction: "asc" }],
  });
  const answers = [];
  for (const scope of [guildScope(SERVER_ID), GLOBAL_SCOPE]) {
    for (const query of [plan(), byChampion]) {
      const result = await runPlan({
        plan: query,
        scope,
        files,
        range,
        limit: 100,
      });
      answers.push({
        rows: result.rows,
        scanned: result.scanned,
        sql: result.compiled.aggregateSql,
        params: result.compiled.aggregateParams,
      });
    }
  }
  const [crawledPlayer] = await crawlFixturePuuids();
  answers.push({
    identities: await resolvePlayerIdentities({
      query: "NightHeight#EUW",
      guildIds: [SERVER_ID],
      lakeDir,
    }),
    crawledPlayer,
  });
  return JSON.stringify(answers, (_key, value: unknown) =>
    typeof value === "bigint" ? `${value.toString()}n` : value,
  );
}

beforeAll(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "crawl-isolation-"));
  const [, sharedPuuid] = await crawlFixturePuuids();
  if (sharedPuuid === undefined) throw new Error("fixture has no players");
  await writeTestLake(lakeDir, {
    serverId: SERVER_ID,
    matchFacts: [
      {
        playerId: 1,
        playerAlias: "Shared",
        matchId: RiotMatchIdSchema.parse("NA1_8000000001"),
        puuid: LeaguePuuidSchema.parse(sharedPuuid),
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 4,
        deaths: 1,
        assists: 7,
        championName: "Ahri",
        gameCreationAt: CREATED,
      },
      {
        playerId: 2,
        playerAlias: "Tracked",
        matchId: RiotMatchIdSchema.parse("NA1_8000000002"),
        puuid: testPuuid("crawl-isolation-tracked"),
        queue: "solo",
        win: false,
        surrendered: false,
        kills: 1,
        deaths: 5,
        assists: 2,
        championName: "Zed",
        gameCreationAt: CREATED,
      },
    ],
  });
});

afterAll(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("crawl files beside a tracked build", () => {
  test("leave every tracked read byte-identical and the tracked fingerprint unchanged", async () => {
    const fingerprint = lakeSchemaFingerprint();
    const before = await resolveLakeFiles(lakeDir);
    expect(before.crawl.matches).toEqual([]);
    const answersBefore = await trackedAnswers(before);

    const buildDir = await readCurrentBuildDir(lakeDir);
    if (buildDir === undefined) throw new Error("test lake has no build");
    await writeCrawlInboxSegment(
      lakeDir,
      await crawlSegment("2026-11-14", ["NA1_8000000001", "NA1_8000000003"]),
    );
    const { summary } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "crawl",
      loadErased: () => Promise.resolve(new Set<string>()),
      now: new Date("2026-11-14T12:00:00.000Z"),
    });
    expect(summary.rows.matches_crawl).toBe(20);

    const after = await resolveLakeFiles(lakeDir);
    expect(after.crawl.matches.length).toBeGreaterThan(0);
    expect(after.crawl.timelineEvents.length).toBeGreaterThan(0);
    const { crawl: _crawl, ...trackedAfter } = after;
    const { crawl: _none, ...trackedBefore } = before;
    expect(trackedAfter).toEqual(trackedBefore);

    expect(await trackedAnswers(after)).toBe(answersBefore);
    expect(lakeSchemaFingerprint()).toBe(fingerprint);
    expect(
      Object.keys(LAKE_TABLE_COLUMNS).some((t) => t.endsWith("_crawl")),
    ).toBe(false);
  });
});
