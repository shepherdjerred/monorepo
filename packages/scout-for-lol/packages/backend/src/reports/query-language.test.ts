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
      render: { kind: "TABLE" },
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

  test("defaults render to TABLE when no clause is present", () => {
    const plan = parseReportQuery(
      "SELECT player, games FROM match_participants GROUP BY player",
    );
    expect(plan.render).toEqual({ kind: "TABLE" });
  });

  test("parses a bare chart render clause (defaults resolve at render)", () => {
    const plan = parseReportQuery(
      "SELECT player, win_rate FROM match_participants GROUP BY player ORDER BY win_rate DESC RENDER bar_chart",
    );
    expect(plan.render).toEqual({
      kind: "BAR_CHART",
      encoding: {},
      options: {},
    });
  });

  test("parses chart channels and options in the WITH clause", () => {
    const plan = parseReportQuery(
      'SELECT player, games, win_rate FROM match_participants GROUP BY player LIMIT 5 RENDER line_chart WITH (x = label, y = win_rate, title = "Win %", y_axis = "Rate")',
    );
    expect(plan.render).toEqual({
      kind: "LINE_CHART",
      encoding: { x: "label", y: "win_rate" },
      options: { title: "Win %", yAxisLabel: "Rate" },
    });
  });

  test("parses a text render kind without a WITH clause", () => {
    const plan = parseReportQuery(
      "SELECT player, games FROM match_participants GROUP BY player RENDER leaderboard",
    );
    expect(plan.render).toEqual({ kind: "LEADERBOARD" });
  });

  test("ignores keywords inside a quoted render title", () => {
    const plan = parseReportQuery(
      'SELECT player, games FROM match_participants GROUP BY player ORDER BY games DESC LIMIT 3 RENDER bar_chart WITH (title = "no limit here")',
    );
    expect(plan.limit).toBe(3);
    expect(plan.orderBy).toBe("games");
    expect(plan.render).toEqual({
      kind: "BAR_CHART",
      encoding: {},
      options: { title: "no limit here" },
    });
  });

  test("rejects an unknown render kind", () => {
    expect(() =>
      parseReportQuery(
        "SELECT player, games FROM match_participants GROUP BY player RENDER pie_chart",
      ),
    ).toThrow("Unknown RENDER kind");
  });

  test("rejects a y channel that is not a SELECTed metric", () => {
    expect(() =>
      parseReportQuery(
        "SELECT player, games FROM match_participants GROUP BY player RENDER bar_chart WITH (y = win_rate)",
      ),
    ).toThrow('RENDER y = "win_rate" is not a SELECTed metric');
  });

  test("rejects a WITH clause on a text render kind", () => {
    expect(() =>
      parseReportQuery(
        "SELECT player, games FROM match_participants GROUP BY player RENDER table WITH (y = games)",
      ),
    ).toThrow("does not take a WITH clause");
  });
});
