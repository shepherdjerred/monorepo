import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";

/**
 * End-to-end coverage of the lake-only metric batch (gold_earned,
 * vision_score, damage_taken, total_damage_dealt, wards_placed, multikills,
 * avg_game_duration, cs_per_minute).
 *
 * The test-lake helper writes fixed per-row values: gold 10000, vision 20,
 * damage_taken 20000, total_damage_dealt 50000, wards 10, multikills 1
 * (double_kills only), duration 1800s, time_played 1800s, creep_score 150.
 */
const { prisma } = createTestDatabase("report-new-metrics-test");
const serverId = testGuildId("939393");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedTwoGames(): Promise<void> {
  await writeTestLake(lakeDir, {
    serverId,
    matchFacts: [1, 2].map((game) => ({
      playerId: 1,
      playerAlias: "Metrics Player",
      matchId: `NA1_metrics_${game.toString()}`,
      puuid: testPuuid("new-metrics-1"),
      queue: "solo",
      win: game === 1,
      surrendered: false,
      kills: 5,
      deaths: 3,
      assists: 7,
      gameCreationAt: now,
    })),
  });
}

describe("new lake metrics", () => {
  test("evaluates bounded expressions, aliases, and HAVING end to end", async () => {
    await seedTwoGames();
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT games, round(per_game(kills + assists), 2) AS takedowns_per_game, round(kills / deaths, 3) AS kill_death_ratio, coalesce(kills / 0, 99) AS safe_fallback FROM match_participants GROUP BY player HAVING games >= 2 AND takedowns_per_game > 10 ORDER BY takedowns_per_game DESC",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.columns).toEqual([
      "label",
      "games",
      "takedowns_per_game",
      "kill_death_ratio",
      "safe_fallback",
    ]);
    expect(result.rows[0]?.values).toEqual([
      { column: "games", value: 2 },
      { column: "takedowns_per_game", value: 12 },
      { column: "kill_death_ratio", value: 1.667 },
      { column: "safe_fallback", value: 99 },
    ]);
  });

  test("sums and per-minute/per-game derivations for players", async () => {
    await seedTwoGames();
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT player, games, gold_earned, vision_score, damage_taken, total_damage_dealt, wards_placed, multikills, avg_game_duration, cs_per_minute FROM match_participants GROUP BY player ORDER BY games DESC",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.values).toEqual([
      { column: "games", value: 2 },
      { column: "gold_earned", value: 20_000 },
      { column: "vision_score", value: 40 },
      { column: "damage_taken", value: 40_000 },
      { column: "total_damage_dealt", value: 100_000 },
      { column: "wards_placed", value: 20 },
      { column: "multikills", value: 2 },
      // 2 games x 1800s -> average 30 minutes.
      { column: "avg_game_duration", value: 30 },
      // 300 CS over 60 minutes played.
      { column: "cs_per_minute", value: 5 },
    ]);
  });

  test("pair duration counts once per game, time played sums across members", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          playerId: 1,
          playerAlias: "Duo A",
          matchId: "NA1_pairmetrics",
          puuid: testPuuid("new-metrics-a"),
          queue: "solo",
          win: true,
          surrendered: false,
          kills: 2,
          deaths: 1,
          assists: 3,
          teamId: 100,
          gameCreationAt: now,
        },
        {
          playerId: 2,
          playerAlias: "Duo B",
          matchId: "NA1_pairmetrics",
          puuid: testPuuid("new-metrics-b"),
          queue: "solo",
          win: true,
          surrendered: false,
          kills: 4,
          deaths: 2,
          assists: 1,
          teamId: 100,
          gameCreationAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT pair, games, gold_earned, avg_game_duration, cs_per_minute FROM player_pairs GROUP BY pair",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.values).toEqual([
      { column: "games", value: 1 },
      { column: "gold_earned", value: 20_000 },
      // ONE game of 30 minutes — not double-counted across the pair.
      { column: "avg_game_duration", value: 30 },
      // Combined 300 CS over combined 60 minutes.
      { column: "cs_per_minute", value: 5 },
    ]);
  });

  test("prematch source reports zeros for stat metrics (legacy convention)", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      prematchFacts: [
        {
          playerId: 1,
          playerAlias: "Prematch Player",
          dedupeKey: "NA1:777",
          puuid: testPuuid("new-metrics-p"),
          queue: "solo",
          observedAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT player, prematches, gold_earned, cs_per_minute FROM prematch_participants GROUP BY player",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rows[0]?.values).toEqual([
      { column: "prematches", value: 1 },
      { column: "gold_earned", value: 0 },
      { column: "cs_per_minute", value: 0 },
    ]);
  });
});
