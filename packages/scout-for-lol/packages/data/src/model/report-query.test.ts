import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "#src/model/report-query-compile.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
import { lintReportQuery } from "#src/model/report-query-lint.ts";
import { completeReportQuery } from "#src/model/report-query-complete.ts";
import { reportChampionLiteral } from "#src/model/report-query-champions.ts";

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

    expect(plan.source).toBe("match_participants");
    expect(plan.groupBy).toBe("player");
    expect(plan.groupBys).toEqual(["player"]);
    expect(plan.metrics).toEqual(["games", "surrenders", "surrender_rate"]);
    expect(plan.selectItems.map((item) => item.key)).toEqual([
      "games",
      "surrenders",
      "surrender_rate",
    ]);
    expect(plan.queueFilter).toEqual(["solo", "flex"]);
    expect(plan.lookbackDays).toBe(30);
    expect(plan.orderBy).toBe("surrender_rate");
    expect(plan.orderDirection).toBe("desc");
    expect(plan.limit).toBe(10);
    expect(plan.having).toEqual([]);
    expect(plan.render).toEqual({ kind: "TABLE" });
  });

  test("compiles group(N) queries to a structured group plan", () => {
    const plan = parseAndCompile(
      "SELECT group, games, win_rate FROM player_groups WHERE games >= 10 GROUP BY group(3) ORDER BY win_rate DESC",
    );

    expect(plan.source).toBe("player_groups");
    expect(plan.groupBy).toBe("group");
    expect(plan.groupSize).toBe(3);
    expect(plan.metrics).toEqual(["games", "win_rate"]);
    expect(plan.minGames).toBe(10);
  });

  test("compiles group(all) queries", () => {
    const plan = parseAndCompile(
      "SELECT group, games FROM player_groups GROUP BY group(all)",
    );

    expect(plan.groupBy).toBe("group");
    expect(plan.groupSize).toBe("all");
  });

  test("normalizes the legacy pair aliases to group(2)", () => {
    const plan = parseAndCompile(
      "SELECT pair, games, wins, losses, win_rate FROM player_pairs WHERE queue IN ('arena') AND games >= 10 GROUP BY pair ORDER BY win_rate DESC LIMIT 10 RENDER leaderboard",
    );

    expect(plan.source).toBe("player_groups");
    expect(plan.groupBy).toBe("group");
    expect(plan.groupSize).toBe(2);
    expect(plan.metrics).toEqual(["games", "wins", "losses", "win_rate"]);
    expect(plan.render.kind).toBe("LEADERBOARD");
  });

  test("canonicalizes ORDER BY on the group label column to label", () => {
    for (const orderTarget of ["group", "pair", "label"]) {
      const plan = parseAndCompile(
        `SELECT group, games FROM player_groups GROUP BY group(2) ORDER BY ${orderTarget} ASC`,
      );
      expect(plan.orderBy).toBe("label");
      expect(plan.orderDirection).toBe("asc");
    }
  });

  test("rejects out-of-range and malformed group sizes", () => {
    for (const bad of ["group(1)", "group(6)", "group()", "group(foo)"]) {
      expect(() =>
        parseAndCompile(
          `SELECT group, games FROM player_groups GROUP BY ${bad}`,
        ),
      ).toThrow("Unknown GROUP BY field");
    }
  });

  test("defaults order and limit when omitted", () => {
    const plan = parseAndCompile(
      "SELECT champion, games FROM match_participants GROUP BY champion",
    );

    expect(plan.orderBy).toBe("games");
    expect(plan.orderDirection).toBe("desc");
    expect(plan.limit).toBe(10);
  });

  test("parses typed row filters", () => {
    const plan = parseAndCompile(
      "SELECT player, games FROM match_participants WHERE kills > 5 AND role IN ('solo', 'support') GROUP BY player",
    );
    expect(plan.filters).toEqual([
      { field: "kills", operator: ">", values: [5] },
      { field: "role", operator: "in", values: ["solo", "support"] },
    ]);
  });

  test("rejects unknown filter fields", () => {
    expect(() =>
      parseAndCompile(
        "SELECT player, games FROM match_participants WHERE secret_stat > 5 GROUP BY player",
      ),
    ).toThrow();
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

  test("resolves a validated champion name to its numeric id", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants WHERE champion_id = champion('Lux') GROUP BY player",
    );

    expect(plan.championId).toBe(99);
  });

  test("supports champion display names containing apostrophes", () => {
    const plan = parseAndCompile(
      `SELECT games FROM match_participants WHERE champion_id = champion("Kai'Sa") GROUP BY player`,
    );

    expect(plan.championId).toBe(145);
  });

  test("reportChampionLiteral double-quotes apostrophe names and round-trips", () => {
    // Kai'Sa (145) has an apostrophe: a single-quoted literal would break the
    // lexer, so reportChampionLiteral must switch to double quotes. Lux (99)
    // has none and stays single-quoted.
    expect(reportChampionLiteral(145)).toBe(`"Kai'Sa"`);
    expect(reportChampionLiteral(99)).toBe(`'Lux'`);

    const plan = parseAndCompile(
      `SELECT games FROM match_participants WHERE champion_id = champion(${reportChampionLiteral(145)}) GROUP BY player`,
    );
    expect(plan.championId).toBe(145);
  });

  test("rejects unknown champion names with a suggestion", () => {
    expect(() =>
      parseAndCompile(
        "SELECT games FROM match_participants WHERE champion_id = champion('Luxx') GROUP BY player",
      ),
    ).toThrow('Did you mean "Lux"?');
  });

  test("compiles SQL-style lookback predicates", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '14 days' GROUP BY player LIMIT 5",
    );

    expect(plan.lookbackDays).toBe(14);
    expect(plan.limit).toBe(5);
  });

  test("requires the source-specific timestamp field", () => {
    expect(() =>
      parseAndCompile(
        "SELECT prematches FROM prematch_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '14 days' GROUP BY player",
      ),
    ).toThrow("uses observed_at");
  });

  test("compiles calculated outputs, aliases, two dimensions, and HAVING", () => {
    const plan = parseAndCompile(
      "SELECT games, round((kills + assists) / games, 2) AS participation FROM match_participants GROUP BY champion, team_position HAVING games >= 5 AND participation > 3 ORDER BY participation DESC",
    );
    expect(plan.groupBys).toEqual(["champion", "team_position"]);
    expect(plan.metrics).toEqual(["games", "kills", "assists"]);
    expect(plan.selectItems.map((item) => item.key)).toEqual([
      "games",
      "participation",
    ]);
    expect(plan.having).toEqual([
      { key: "games", operator: ">=", value: 5 },
      { key: "participation", operator: ">", value: 3 },
    ]);
  });

  test("supports UTC temporal buckets and aggregate-all reports", () => {
    expect(
      parseAndCompile(
        "SELECT games FROM match_participants GROUP BY month ORDER BY label ASC",
      ).groupBys,
    ).toEqual(["month"]);
    expect(
      parseAndCompile(
        "SELECT games, win_rate FROM match_participants GROUP BY all RENDER kpi_card WITH (y = (games, win_rate))",
      ).groupBys,
    ).toEqual(["all"]);
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

describe("RENDER clause", () => {
  test("defaults render to TABLE when no clause is present", () => {
    const plan = parseAndCompile(
      "SELECT player, games FROM match_participants GROUP BY player",
    );
    expect(plan.render).toEqual({ kind: "TABLE" });
  });

  test("parses a bare chart render clause (defaults resolve at render)", () => {
    const plan = parseAndCompile(
      "SELECT player, win_rate FROM match_participants GROUP BY player ORDER BY win_rate DESC RENDER bar_chart",
    );
    expect(plan.render).toEqual({
      kind: "BAR_CHART",
      encoding: {},
      options: {},
    });
  });

  test("parses chart channels and options in the WITH clause", () => {
    const plan = parseAndCompile(
      'SELECT player, games, win_rate FROM match_participants GROUP BY player LIMIT 5 RENDER line_chart WITH (x = label, y = win_rate, title = "Win %", y_axis = "Rate")',
    );
    expect(plan.render).toEqual({
      kind: "LINE_CHART",
      encoding: { x: "label", y: "win_rate" },
      options: { title: "Win %", yAxisLabel: "Rate" },
    });
  });

  test("parses multi-series appearance options and custom colors", () => {
    const plan = parseAndCompile(
      'SELECT games, wins, losses FROM match_participants GROUP BY week RENDER stacked_bar WITH (y = (wins, losses), theme = minimal_light, palette = colorblind, colors = (#112233, #abcdef), orientation = vertical, labels = value, legend = top, sort = asc, smooth = true, subtitle = "Weekly")',
    );
    expect(plan.render).toEqual({
      kind: "STACKED_BAR",
      encoding: { y: ["wins", "losses"] },
      options: {
        theme: "minimal_light",
        palette: "colorblind",
        colors: ["#112233", "#abcdef"],
        orientation: "vertical",
        labels: "value",
        legend: "top",
        sort: "asc",
        smooth: true,
        subtitle: "Weekly",
      },
    });
  });

  test("rejects chart shapes that cannot render", () => {
    expect(() =>
      parseAndCompile(
        "SELECT games, wins FROM match_participants GROUP BY player RENDER radar_chart WITH (y = (games, wins))",
      ),
    ).toThrow("between three and eight");
    expect(() =>
      parseAndCompile(
        "SELECT games FROM match_participants GROUP BY champion RENDER heatmap WITH (value = games)",
      ),
    ).toThrow("exactly two GROUP BY");
  });

  test("parses a text render kind without a WITH clause", () => {
    const plan = parseAndCompile(
      "SELECT player, games FROM match_participants GROUP BY player RENDER leaderboard",
    );
    expect(plan.render).toEqual({ kind: "LEADERBOARD" });
  });

  test("ignores keywords inside a quoted render title", () => {
    const plan = parseAndCompile(
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
      parseAndCompile(
        "SELECT player, games FROM match_participants GROUP BY player RENDER pie_chart",
      ),
    ).toThrow("Unknown RENDER kind");
  });

  test("rejects a y channel that is not a SELECTed metric", () => {
    expect(() =>
      parseAndCompile(
        "SELECT player, games FROM match_participants GROUP BY player RENDER bar_chart WITH (y = win_rate)",
      ),
    ).toThrow('RENDER y = "win_rate" is not a SELECTed metric');
  });

  test("rejects a WITH clause on a text render kind", () => {
    expect(() =>
      parseAndCompile(
        "SELECT player, games FROM match_participants GROUP BY player RENDER table WITH (y = games)",
      ),
    ).toThrow("does not take a WITH clause");
  });

  test("lints an unknown render kind with a positioned error", () => {
    const text =
      "select player, games from match_participants group by player render pie_chart";
    const diagnostics = lintReportQuery(text);
    const renderError = diagnostics.find((d) =>
      d.message.includes("Unknown RENDER kind"),
    );
    expect(renderError?.severity).toBe("error");
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

  test("does not flag ORDER BY on the group label column", () => {
    for (const orderTarget of ["group", "pair", "label"]) {
      const diagnostics = lintReportQuery(
        `select group, games from player_groups group by group(2) order by ${orderTarget} asc`,
      );
      expect(diagnostics).toHaveLength(0);
    }
  });

  test("positions invalid HAVING diagnostics", () => {
    const text =
      "select games from match_participants group by player having missing > 2";
    const diagnostic = lintReportQuery(text).find((entry) =>
      entry.message.includes("HAVING target"),
    );
    expect(diagnostic?.severity).toBe("error");
    expect(text.slice(diagnostic?.span.start, diagnostic?.span.end)).toBe(
      "missing > 2",
    );
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
    expect(items.some((item) => item.label === "per_game")).toBe(true);
  });

  test("suggests aggregate outputs after HAVING", () => {
    const text = "select games from match_participants group by player having ";
    const items = completeReportQuery(text, text.length);
    expect(items.some((item) => item.label === "games")).toBe(true);
  });

  test("suggests queue values inside queue IN (...)", () => {
    const text = "select games from match_participants where queue in (";
    const items = completeReportQuery(text, text.length);
    expect(items.some((item) => item.label === "solo")).toBe(true);
    expect(items.every((item) => item.kind === "queue")).toBe(true);
  });
});
