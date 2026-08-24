import { describe, expect, test } from "vitest";
import type { ScoutQlTimeWindow } from "#src/model/scoutql/plan.ts";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";

// ── Per-pass units ───────────────────────────────────────────────────────────
// Window recognition, display-kind inference, additivity, and evidence each
// have a handful of shapes that are awkward to read in a whole-query corpus.

function windowOf(where: string): ScoutQlTimeWindow {
  return analyzeScoutQl(
    `SELECT COUNT(*) AS g FROM match_participants WHERE ${where} GROUP BY player`,
  ).timeWindow;
}

function outputOf(select: string) {
  const analysis = analyzeScoutQl(
    `SELECT ${select} FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player`,
  );
  const [output] = analysis.outputs;
  if (output === undefined) {
    throw new Error(`no output analyzed for: ${select}`);
  }
  return output;
}

describe("relative window recognition", () => {
  test("the canonical shape", () => {
    expect(
      windowOf("game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY"),
    ).toEqual({ kind: "relative", amount: 30, unit: "day" });
  });

  test("the operands may be written the other way round", () => {
    expect(
      windowOf("CURRENT_TIMESTAMP - INTERVAL 12 WEEK <= game_creation_at"),
    ).toEqual({ kind: "relative", amount: 12, unit: "week" });
  });

  test("a strict > is accepted — one instant is not a meaningful difference", () => {
    expect(
      windowOf("game_creation_at > CURRENT_TIMESTAMP - INTERVAL 6 MONTH"),
    ).toEqual({ kind: "relative", amount: 6, unit: "month" });
  });

  test("the plural unit spelling is the same window", () => {
    expect(
      windowOf("game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 2 YEARS"),
    ).toEqual({ kind: "relative", amount: 2, unit: "year" });
  });

  test("the string interval form is the same window", () => {
    expect(
      windowOf("game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'"),
    ).toEqual({ kind: "relative", amount: 30, unit: "day" });
  });

  test("a sub-day interval is a real filter, not a window", () => {
    expect(
      windowOf("game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 6 HOUR"),
    ).toEqual({ kind: "bounded" });
  });

  test("an upper bound alone is bounded, not relative", () => {
    expect(windowOf("game_creation_at <= CURRENT_TIMESTAMP")).toEqual({
      kind: "bounded",
    });
  });

  test("a recognized window is hoisted out of the executed predicate", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player",
    );
    expect(plan.where).toBeUndefined();
    expect(plan.timeWindow).toEqual({
      kind: "relative",
      amount: 30,
      unit: "day",
    });
  });

  test("a second time predicate stays in WHERE and still applies", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "AND game_creation_at <= CURRENT_TIMESTAMP - INTERVAL 1 DAY GROUP BY player",
    );
    expect(plan.timeWindow).toEqual({
      kind: "relative",
      amount: 30,
      unit: "day",
    });
    expect(plan.where?.kind).toBe("compare");
  });

  test("a time predicate on another timestamp column is bounded", () => {
    expect(
      windowOf("game_end_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY"),
    ).toEqual({ kind: "unbounded" });
  });
});

describe("calendar window recognition", () => {
  test("with an explicit zone", () => {
    expect(
      windowOf(
        "(game_creation_at AT TIME ZONE 'America/New_York')::DATE BETWEEN '2026-03-01' AND '2026-03-31'",
      ),
    ).toEqual({
      kind: "calendar",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      timezone: "America/New_York",
    });
  });

  test("without a zone, in UTC", () => {
    expect(
      windowOf("game_creation_at::DATE BETWEEN '2026-03-01' AND '2026-03-31'"),
    ).toEqual({
      kind: "calendar",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      timezone: "UTC",
    });
  });

  test("CAST(… AS DATE) is the same shape", () => {
    expect(
      windowOf(
        "CAST(game_creation_at AS DATE) BETWEEN '2026-03-01' AND '2026-03-31'",
      ),
    ).toEqual({
      kind: "calendar",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      timezone: "UTC",
    });
  });

  test("a NOT BETWEEN is a filter, not a window", () => {
    expect(
      windowOf(
        "game_creation_at::DATE NOT BETWEEN '2026-03-01' AND '2026-03-31'",
      ),
    ).toEqual({ kind: "bounded" });
  });

  test("a BETWEEN over the raw timestamp is a filter, not a calendar window", () => {
    expect(
      windowOf("game_creation_at BETWEEN '2026-03-01' AND '2026-03-31'"),
    ).toEqual({ kind: "bounded" });
  });
});

describe("display-kind inference", () => {
  test("AVG over a boolean cast is a percentage", () => {
    expect(outputOf("AVG(win::INT) AS r").displayKind).toBe("percent");
  });

  test("… including under FILTER and inside ROUND", () => {
    expect(
      outputOf("ROUND(AVG(surrendered::DOUBLE) FILTER (WHERE win), 2) AS r")
        .displayKind,
    ).toBe("percent");
  });

  test("aggregates over a duration column are durations", () => {
    expect(outputOf("MEDIAN(time_played) AS m").displayKind).toBe("duration");
    expect(outputOf("MAX(total_time_spent_dead) AS m").displayKind).toBe(
      "duration",
    );
  });

  test("counts and integer sums are counts", () => {
    expect(outputOf("COUNT(*) AS c").displayKind).toBe("count");
    expect(outputOf("COUNT(DISTINCT champion_id) AS c").displayKind).toBe(
      "count",
    );
    expect(outputOf("SUM(kills) AS c").displayKind).toBe("count");
  });

  test("the macros are ratios", () => {
    expect(outputOf("kda() AS k").displayKind).toBe("ratio");
    expect(outputOf("per_minute(creep_score) AS k").displayKind).toBe("ratio");
  });

  test("anything else is a decimal", () => {
    expect(outputOf("AVG(kills) AS a").displayKind).toBe("decimal");
    expect(outputOf("STDDEV(kills) AS s").displayKind).toBe("decimal");
    expect(outputOf("SUM(kills) / 2 AS half").displayKind).toBe("decimal");
  });
});

describe("additivity", () => {
  test("sums and counts accumulate", () => {
    expect(outputOf("SUM(kills) AS k").additive).toBe(true);
    expect(outputOf("COUNT(*) AS c").additive).toBe(true);
    expect(outputOf("COUNT(*) FILTER (WHERE win) AS c").additive).toBe(true);
  });

  test("sums composed with +/- and scaled by a literal accumulate", () => {
    expect(outputOf("SUM(kills) + SUM(assists) AS takedowns").additive).toBe(
      true,
    );
    expect(outputOf("SUM(kills) * 2 AS doubled").additive).toBe(true);
    expect(outputOf("SUM(kills) / 2 AS half").additive).toBe(true);
  });

  test("averages, distinct counts, and quotients do not", () => {
    expect(outputOf("AVG(kills) AS a").additive).toBe(false);
    expect(outputOf("COUNT(DISTINCT champion_id) AS c").additive).toBe(false);
    expect(outputOf("SUM(kills) / NULLIF(SUM(deaths), 0) AS r").additive).toBe(
      false,
    );
    expect(outputOf("ROUND(SUM(kills), 2) AS r").additive).toBe(false);
  });
});

describe("evidence inference", () => {
  test("a rate gets successes and trials", () => {
    expect(outputOf("AVG(win::INT) AS r").evidence.kind).toBe("rate");
  });

  test("a plain average gets its sum and count", () => {
    const evidence = outputOf("AVG(kills) AS a").evidence;
    expect(evidence).toEqual({
      kind: "ratio",
      numerator: {
        kind: "aggregate",
        func: "sum",
        arg: { kind: "column", column: "kills" },
        distinct: false,
      },
      denominator: {
        kind: "aggregate",
        func: "count",
        arg: { kind: "column", column: "kills" },
        distinct: false,
      },
    });
  });

  test("an additive quotient keeps both sides as the ratio", () => {
    const evidence = outputOf(
      "SUM(kills) / NULLIF(SUM(deaths), 0) AS r",
    ).evidence;
    expect(evidence.kind).toBe("ratio");
  });

  test("everything else is a sample", () => {
    expect(outputOf("COUNT(*) AS c").evidence.kind).toBe("sample");
    expect(outputOf("MEDIAN(kills) AS m").evidence.kind).toBe("sample");
    expect(outputOf("kda() AS k").evidence.kind).toBe("sample");
  });

  test("evidence never references another output by alias", () => {
    const analysis = analyzeScoutQl(
      "SELECT SUM(kills) AS k, SUM(kills) / NULLIF(SUM(deaths), 0) AS r " +
        "FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player",
    );
    const serialized = JSON.stringify(
      analysis.outputs.map((output) => output.evidence),
    );
    expect(serialized).not.toContain("output-ref");
  });
});

describe("grouping names", () => {
  test("a SELECT echo with an alias names the grouping", () => {
    const plan = compileScoutQl(
      "SELECT DATE_TRUNC('week', game_creation_at) AS wk, COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY DATE_TRUNC('week', game_creation_at)",
    );
    expect(plan.groupings[0]?.name).toBe("wk");
    expect(plan.outputs[0]?.expr).toEqual({ kind: "grouping-ref", index: 0 });
  });

  test("without an echo, DATE_TRUNC is named after its part", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY DATE_TRUNC('month', game_creation_at)",
    );
    expect(plan.groupings[0]?.name).toBe("month");
  });

  test("a column grouping is named after the column", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY champion",
    );
    expect(plan.groupings[0]?.name).toBe("champion");
  });

  test("GROUP BY may name a SELECT alias, DuckDB-style", () => {
    const plan = compileScoutQl(
      "SELECT DATE_TRUNC('week', game_creation_at) AS wk, COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY wk",
    );
    expect(plan.groupings[0]).toEqual({
      kind: "date-trunc",
      part: "week",
      column: "game_creation_at",
      timezone: "UTC",
      name: "wk",
    });
  });

  test("a bucket expression must be echoed with an alias to earn a name", () => {
    const codes = analyzeScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY FLOOR(game_duration_seconds / 300) * 300",
    ).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("alias-required");
  });
});

describe("ORDER BY targets", () => {
  test("an output alias, a grouping name, and a repeated expression all resolve", () => {
    const plan = compileScoutQl(
      "SELECT DATE_TRUNC('week', game_creation_at) AS wk, COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY DATE_TRUNC('week', game_creation_at) ORDER BY g DESC, wk ASC",
    );
    expect(plan.orderBy).toEqual([
      { target: { kind: "output", name: "g" }, direction: "desc" },
      { target: { kind: "output", name: "wk" }, direction: "asc" },
    ]);
  });

  test("a direction defaults to ascending", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player ORDER BY g",
    );
    expect(plan.orderBy[0]?.direction).toBe("asc");
  });
});

describe("player references", () => {
  test("the same player named twice is one reference", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE (player('Bob') OR player('bob')) " +
        "AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY champion",
    );
    expect(plan.playerRefs).toEqual(["Bob"]);
  });

  test("two players under OR are legal and both lift", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS g FROM match_participants " +
        "WHERE (player('Bob') OR player('Alice')) " +
        "AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY champion",
    );
    expect(plan.playerRefs).toEqual(["Bob", "Alice"]);
    expect(plan.where).toEqual({
      kind: "or",
      operands: [
        { kind: "player-ref", index: 0 },
        { kind: "player-ref", index: 1 },
      ],
    });
  });
});

describe("limits", () => {
  test("a stated LIMIT wins", () => {
    expect(
      compileScoutQl(
        "SELECT COUNT(*) AS g FROM match_participants " +
          "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player LIMIT 25",
      ).limit,
    ).toBe(25);
  });

  test("a charted time series gets the temporal row budget", () => {
    expect(
      compileScoutQl(
        "SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS g FROM match_participants " +
          "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
          "GROUP BY DATE_TRUNC('day', game_creation_at) RENDER line_chart",
      ).limit,
    ).toBe(2000);
  });

  test("the same time series as a table keeps the default", () => {
    expect(
      compileScoutQl(
        "SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS g FROM match_participants " +
          "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
          "GROUP BY DATE_TRUNC('day', game_creation_at)",
      ).limit,
    ).toBe(10);
  });
});
