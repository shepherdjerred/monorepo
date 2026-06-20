import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "#src/model/report-query-compile.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
import { lintReportQuery } from "#src/model/report-query-lint.ts";
import { completeReportQuery } from "#src/model/report-query-complete.ts";

describe("parseAndCompile", () => {
  test("parses a leaderboard aggregate query", () => {
    const plan = parseAndCompile(`
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
    const plan = parseAndCompile(
      "SELECT champion, games FROM match_participants GROUP BY champion",
    );

    expect(plan.orderBy).toBe("games");
    expect(plan.orderDirection).toBe("desc");
    expect(plan.limit).toBeUndefined();
  });

  test("rejects unsupported where clauses", () => {
    expect(() =>
      parseAndCompile(
        "SELECT player, games FROM match_participants WHERE kills > 5 GROUP BY player",
      ),
    ).toThrow("Unsupported report WHERE clause");
  });

  test("parses additional bounded filters", () => {
    const plan = parseAndCompile(`
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

  test("rejects unknown source", () => {
    expect(() =>
      parseAndCompile("SELECT games FROM nope GROUP BY player"),
    ).toThrow();
  });

  test("rejects a structurally invalid query", () => {
    expect(() => parseAndCompile("SELECT games")).toThrow(
      "Invalid report query",
    );
  });
});

describe("parseReportQuery (AST + spans)", () => {
  test("captures spans for the source token", () => {
    const text = "select games from match_participants group by player";
    const { ast, diagnostics } = parseReportQuery(text);
    expect(diagnostics).toHaveLength(0);
    expect(ast.source?.value).toBe("match_participants");
    expect(text.slice(ast.source?.span.start, ast.source?.span.end)).toBe(
      "match_participants",
    );
  });

  test("does not throw on incomplete input", () => {
    const { ast } = parseReportQuery("select ga");
    expect(ast.select.length).toBeGreaterThanOrEqual(0);
  });
});

describe("lintReportQuery", () => {
  test("flags an unknown metric with a positioned error", () => {
    const text = "select bogus from match_participants group by player";
    const diagnostics = lintReportQuery(text);
    const unknown = diagnostics.find((d) => d.message.includes("bogus"));
    expect(unknown?.severity).toBe("error");
    expect(text.slice(unknown?.span.start, unknown?.span.end)).toBe("bogus");
  });

  test("warns (not errors) on an unknown queue value", () => {
    const diagnostics = lintReportQuery(
      "select games from match_participants where queue in (ranked_solo) group by player",
    );
    const queueWarning = diagnostics.find((d) =>
      d.message.includes("ranked_solo"),
    );
    expect(queueWarning?.severity).toBe("warning");
  });

  test("reports no diagnostics for a valid query", () => {
    const diagnostics = lintReportQuery(
      "select games, win_rate from match_participants where queue in (solo) group by player order by games desc limit 10",
    );
    expect(diagnostics).toHaveLength(0);
  });
});

describe("completeReportQuery", () => {
  test("suggests sources after FROM", () => {
    const text = "select games from ";
    const items = completeReportQuery(text, text.length);
    expect(items.some((item) => item.label === "match_participants")).toBe(
      true,
    );
    expect(items.every((item) => item.kind === "source")).toBe(true);
  });

  test("suggests metrics after SELECT", () => {
    const text = "select ";
    const items = completeReportQuery(text, text.length);
    expect(items.some((item) => item.label === "win_rate")).toBe(true);
  });

  test("suggests queue values inside queue IN (...)", () => {
    const text = "select games from match_participants where queue in (";
    const items = completeReportQuery(text, text.length);
    expect(items.some((item) => item.label === "solo")).toBe(true);
    expect(items.every((item) => item.kind === "queue")).toBe(true);
  });
});
