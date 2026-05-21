import { describe, expect, test } from "bun:test";
import { parseReportQuery } from "#src/reports/query-language.ts";

describe("parseReportQuery", () => {
  test("parses a leaderboard aggregate query", () => {
    const plan = parseReportQuery(`
      SELECT player, games, surrenders, surrender_rate
      FROM match_participants
      WHERE queue IN ('solo', "flex")
      GROUP BY player
      ORDER BY surrender_rate DESC
      LIMIT 10
    `);

    expect(plan).toEqual({
      source: "match_participants",
      groupBy: "player",
      metrics: ["games", "surrenders", "surrender_rate"],
      queueFilter: ["solo", "flex"],
      championId: undefined,
      minGames: undefined,
      competitionId: undefined,
      orderBy: "surrender_rate",
      orderDirection: "desc",
      limit: 10,
    });
  });

  test("defaults order and limit when omitted", () => {
    const plan = parseReportQuery(
      "SELECT champion, games FROM match_participants GROUP BY champion",
    );

    expect(plan.orderBy).toBe("games");
    expect(plan.orderDirection).toBe("desc");
    expect(plan.limit).toBeUndefined();
  });

  test("rejects unsupported where clauses", () => {
    expect(() =>
      parseReportQuery(
        "SELECT player, games FROM match_participants WHERE kills > 5 GROUP BY player",
      ),
    ).toThrow("Unsupported report WHERE clause");
  });

  test("parses additional bounded filters", () => {
    const plan = parseReportQuery(`
      SELECT player, games, wins
      FROM competition_match_participants
      WHERE competition_id = 12 AND queue IN ('arena') AND champion_id = 22 AND games >= 5
      GROUP BY player
      ORDER BY wins DESC
    `);

    expect(plan.competitionId).toBe(12);
    expect(plan.queueFilter).toEqual(["arena"]);
    expect(plan.championId).toBe(22);
    expect(plan.minGames).toBe(5);
  });
});
