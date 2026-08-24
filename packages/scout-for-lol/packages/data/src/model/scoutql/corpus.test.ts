import { describe, expect, test } from "vitest";
import type { ReportOutputFormat } from "#src/model/report.ts";
import type { ScoutQlDiagnosticCode } from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlPlan,
  ScoutQlTimeWindow,
} from "#src/model/scoutql/plan.ts";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";

// ── ScoutQL v2 corpus ────────────────────────────────────────────────────────
// Table-driven: every query here must compile, and each case pins the parts of
// the plan a reader would want to check by eye — the window that was hoisted,
// the grouping shapes, and the per-output display/evidence inference that the
// renderer and the statistics layer consume.

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

type Expectation = {
  name: string;
  query: string;
  timeWindow: ScoutQlTimeWindow["kind"];
  render?: ReportOutputFormat;
  limit?: number;
  /** `name:displayKind:evidence` with a trailing `+` when additive. */
  outputs?: string[];
  /** `kind/name`. */
  groupings?: string[];
  playerRefs?: string[];
  competitionId?: number;
  warnings?: ScoutQlDiagnosticCode[];
  /** Conjuncts left in the executed predicate (recognized ones are hoisted). */
  hasWhere?: boolean;
};

function describeOutputs(plan: ScoutQlPlan): string[] {
  return plan.outputs.map(
    (output) =>
      `${output.name}:${output.displayKind}:${output.evidence.kind}${output.additive ? "+" : ""}`,
  );
}

function describeGroupings(plan: ScoutQlPlan): string[] {
  return plan.groupings.map((grouping) => `${grouping.kind}/${grouping.name}`);
}

export const CORPUS: Expectation[] = [
  {
    name: "preset: activity leaders",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants WHERE ${BOUND} GROUP BY player ORDER BY games DESC LIMIT 10 RENDER leaderboard`,
    timeWindow: "relative",
    render: "LEADERBOARD",
    limit: 10,
    outputs: ["games:count:sample+", "win_rate:percent:rate"],
    groupings: ["column/player"],
    hasWhere: false,
  },
  {
    name: "preset: ranked win rate with a games floor",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants WHERE queue IN ('solo') AND ${BOUND} GROUP BY player HAVING games >= 10 ORDER BY win_rate DESC RENDER bar_chart WITH (y = win_rate)`,
    timeWindow: "relative",
    render: "BAR_CHART",
    outputs: ["games:count:sample+", "win_rate:percent:rate"],
    groupings: ["column/player"],
    hasWhere: true,
  },
  {
    name: "preset: weekly results with a period comparison",
    query:
      "SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses " +
      "FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY " +
      "GROUP BY DATE_TRUNC('week', game_creation_at) ORDER BY week ASC " +
      "RENDER stacked_bar WITH (y = (wins, losses), compare = previous_period)",
    timeWindow: "relative",
    render: "STACKED_BAR",
    limit: 2000,
    outputs: [
      "week:timestamp:sample",
      "wins:count:sample+",
      "losses:count:sample+",
    ],
    groupings: ["date-trunc/week"],
  },
  {
    name: "conditional aggregate with FILTER",
    query: `SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE surrendered) AS surrenders, AVG(win::INT) FILTER (WHERE queue = 'solo') AS solo_win_rate FROM match_participants WHERE ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    outputs: [
      "games:count:sample+",
      "surrenders:count:sample+",
      "solo_win_rate:percent:rate",
    ],
    groupings: ["column/player"],
  },
  {
    name: "COUNT(DISTINCT …) is not additive",
    query: `SELECT COUNT(DISTINCT champion_id) AS champions FROM match_participants WHERE ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    outputs: ["champions:count:sample"],
    groupings: ["column/player"],
  },
  {
    name: "percentiles and spread",
    query: `SELECT MEDIAN(total_damage_dealt_to_champions) AS median_damage, QUANTILE_CONT(total_damage_dealt_to_champions, 0.9) AS p90, STDDEV(kills) AS spread FROM match_participants WHERE ${BOUND} GROUP BY champion`,
    timeWindow: "relative",
    outputs: [
      "median_damage:decimal:sample",
      "p90:decimal:sample",
      "spread:decimal:sample",
    ],
    groupings: ["column/champion"],
  },
  {
    name: "histogram over a FLOOR bucket",
    query: `SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY FLOOR(game_duration_seconds / 300) * 300 RENDER histogram`,
    timeWindow: "relative",
    render: "HISTOGRAM",
    outputs: ["bucket:decimal:sample", "games:count:sample+"],
    groupings: ["expression/bucket"],
  },
  {
    name: "box plot names its five summary outputs",
    query:
      `SELECT champion, MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high ` +
      `FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER box_plot WITH (y = (low, q1, med, q3, high))`,
    timeWindow: "relative",
    render: "BOX_PLOT",
    groupings: ["column/champion"],
  },
  {
    name: "player() and champion() references",
    query: `SELECT COUNT(*) AS games FROM match_participants WHERE player('Bob') AND champion_id = champion('Jinx') AND ${BOUND} GROUP BY champion`,
    timeWindow: "relative",
    playerRefs: ["Bob"],
    groupings: ["column/champion"],
  },
  {
    name: "player = player('…') is accepted as the same reference",
    query: `SELECT COUNT(*) AS games FROM match_participants WHERE player = player('Bob') AND ${BOUND} GROUP BY champion`,
    timeWindow: "relative",
    playerRefs: ["Bob"],
  },
  {
    name: "OR / NOT logic",
    query: `SELECT COUNT(*) AS games FROM match_participants WHERE (queue = 'solo' OR queue = 'flex') AND NOT surrendered AND ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    hasWhere: true,
  },
  {
    name: "GROUP BY ALL takes every non-aggregate output",
    query: `SELECT champion, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY ALL`,
    timeWindow: "relative",
    groupings: ["column/champion"],
    outputs: ["champion:text:sample", "games:count:sample+"],
  },
  {
    name: "grand total (no GROUP BY)",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants WHERE ${BOUND}`,
    timeWindow: "relative",
    groupings: [],
    outputs: ["games:count:sample+", "win_rate:percent:rate"],
  },
  {
    name: "comments are ignored by analysis",
    query: `-- how active is everyone?\nSELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player -- by player`,
    timeWindow: "relative",
    groupings: ["column/player"],
  },
  {
    name: "calendar window with AT TIME ZONE",
    query:
      "SELECT champion, COUNT(*) AS games FROM match_participants " +
      "WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-02-01' " +
      "GROUP BY champion",
    timeWindow: "calendar",
    hasWhere: false,
  },
  {
    name: "calendar window without a zone is UTC",
    query:
      "SELECT champion, COUNT(*) AS games FROM match_participants " +
      "WHERE game_creation_at::DATE BETWEEN '2026-01-01' AND '2026-02-01' GROUP BY champion",
    timeWindow: "calendar",
  },
  {
    name: "an unrecognized time predicate stays in WHERE and reads as bounded",
    query:
      "SELECT COUNT(*) AS games FROM match_participants " +
      "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 6 HOUR GROUP BY player",
    timeWindow: "bounded",
    hasWhere: true,
  },
  {
    name: "no time bound is legal, and warns",
    query:
      "SELECT champion, COUNT(*) AS games FROM match_participants GROUP BY champion",
    timeWindow: "unbounded",
    warnings: ["time-window-unbounded"],
  },
  {
    name: "player_groups with group(all)",
    query: `SELECT COUNT(*) AS games, SUM(kills) AS kills FROM player_groups WHERE win AND ${BOUND} GROUP BY group(all) ORDER BY games DESC RENDER leaderboard WITH (mentions = all)`,
    timeWindow: "relative",
    render: "LEADERBOARD",
    groupings: ["group/group"],
    hasWhere: true,
  },
  {
    name: "competition source lifts competition_id out of WHERE",
    query: `SELECT COUNT(*) AS games FROM competition_match_participants WHERE competition_id = 12 AND ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    competitionId: 12,
    hasWhere: false,
  },
  {
    name: "rank snapshot has no time window",
    query:
      "SELECT player, MIN(rank) AS best FROM rank_current GROUP BY player ORDER BY best ASC",
    timeWindow: "snapshot",
    outputs: ["player:text:sample", "best:count:sample"],
  },
  {
    name: "macros: kda() and per_minute()",
    query: `SELECT kda() AS kda, per_minute(creep_score) AS cs_per_minute FROM match_participants WHERE ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    outputs: ["kda:ratio:sample", "cs_per_minute:ratio:sample"],
  },
  {
    name: "duration columns format as durations",
    query: `SELECT SUM(total_time_spent_dead) AS dead_time, AVG(game_duration_seconds) AS length FROM match_participants WHERE ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    outputs: ["dead_time:duration:sample+", "length:duration:ratio"],
  },
  {
    name: "an additive quotient earns ratio evidence",
    query: `SELECT SUM(kills) / NULLIF(SUM(deaths), 0) AS ratio FROM match_participants WHERE ${BOUND} GROUP BY player`,
    timeWindow: "relative",
    outputs: ["ratio:decimal:ratio"],
  },
  {
    name: "RENDER format overrides the inferred display kind",
    query: `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player RENDER bar_chart WITH (format = (games = decimal))`,
    timeWindow: "relative",
    render: "BAR_CHART",
    outputs: ["games:decimal:sample+"],
  },
  {
    name: "daily buckets get the temporal row budget",
    query: `SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY DATE_TRUNC('day', game_creation_at) RENDER calendar_heatmap`,
    timeWindow: "relative",
    render: "CALENDAR_HEATMAP",
    limit: 2000,
    groupings: ["date-trunc/day"],
  },
];

describe("corpus: every query compiles to the expected plan", () => {
  for (const expectation of CORPUS) {
    test(expectation.name, () => {
      const analysis = analyzeScoutQl(expectation.query);
      expect(
        analysis.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
      const warnings = analysis.diagnostics
        .filter((diagnostic) => diagnostic.severity !== "error")
        .map((diagnostic) => diagnostic.code);
      expect(warnings).toEqual(expectation.warnings ?? []);

      const plan = compileScoutQl(expectation.query);
      expect(plan.timeWindow.kind).toBe(expectation.timeWindow);
      if (expectation.render !== undefined) {
        expect(plan.render.kind).toBe(expectation.render);
      }
      if (expectation.limit !== undefined) {
        expect(plan.limit).toBe(expectation.limit);
      }
      if (expectation.outputs !== undefined) {
        expect(describeOutputs(plan)).toEqual(expectation.outputs);
      }
      if (expectation.groupings !== undefined) {
        expect(describeGroupings(plan)).toEqual(expectation.groupings);
      }
      if (expectation.playerRefs !== undefined) {
        expect(plan.playerRefs).toEqual(expectation.playerRefs);
      }
      if (expectation.competitionId !== undefined) {
        expect(plan.competitionId).toBe(expectation.competitionId);
      }
      if (expectation.hasWhere !== undefined) {
        expect(plan.where !== undefined).toBe(expectation.hasWhere);
      }
    });
  }
});

describe("plan details worth pinning exactly", () => {
  test("kda() expands to takedowns over at-least-one death", () => {
    const plan = compileScoutQl(
      `SELECT kda() AS kda FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    expect(plan.outputs[0]?.expr).toEqual({
      kind: "arithmetic",
      op: "/",
      left: {
        kind: "arithmetic",
        op: "+",
        left: {
          kind: "aggregate",
          func: "sum",
          arg: { kind: "column", column: "kills" },
          distinct: false,
        },
        right: {
          kind: "aggregate",
          func: "sum",
          arg: { kind: "column", column: "assists" },
          distinct: false,
        },
      },
      right: {
        kind: "scalar-call",
        func: "greatest",
        args: [
          {
            kind: "aggregate",
            func: "sum",
            arg: { kind: "column", column: "deaths" },
            distinct: false,
          },
          { kind: "literal", value: 1 },
        ],
      },
    });
  });

  test("per_minute(x) divides by minutes played, guarding zero", () => {
    const plan = compileScoutQl(
      `SELECT per_minute(creep_score) AS cs FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    expect(plan.outputs[0]?.expr).toEqual({
      kind: "arithmetic",
      op: "/",
      left: {
        kind: "aggregate",
        func: "sum",
        arg: { kind: "column", column: "creep_score" },
        distinct: false,
      },
      right: {
        kind: "scalar-call",
        func: "nullif",
        args: [
          {
            kind: "arithmetic",
            op: "/",
            left: {
              kind: "aggregate",
              func: "sum",
              arg: { kind: "column", column: "time_played" },
              distinct: false,
            },
            right: { kind: "literal", value: 60 },
          },
          { kind: "literal", value: 0 },
        ],
      },
    });
  });

  test("champion('…') constant-folds to its id", () => {
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE champion_id = champion('Jinx') AND ${BOUND} GROUP BY player`,
    );
    expect(plan.where).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "column", column: "champion_id" },
      right: { kind: "literal", value: 222 },
    });
  });

  test("a rate output carries successes/trials under the same FILTER", () => {
    const plan = compileScoutQl(
      `SELECT AVG(win::INT) FILTER (WHERE queue = 'solo') AS solo_win_rate FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    const filter = {
      kind: "compare",
      op: "=",
      left: { kind: "column", column: "queue" },
      right: { kind: "literal", value: "solo" },
    };
    expect(plan.outputs[0]?.evidence).toEqual({
      kind: "rate",
      successes: {
        kind: "aggregate",
        func: "sum",
        arg: {
          kind: "cast",
          to: "int",
          operand: { kind: "column", column: "win" },
        },
        distinct: false,
        filter,
      },
      trials: { kind: "count-star", filter },
    });
  });

  test("HAVING references an output by alias", () => {
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player HAVING games >= 10`,
    );
    expect(plan.having).toEqual({
      kind: "compare",
      op: ">=",
      left: { kind: "output-ref", name: "games" },
      right: { kind: "literal", value: 10 },
    });
  });

  test("a recognized calendar window is hoisted with its zone", () => {
    const plan = compileScoutQl(
      "SELECT champion, COUNT(*) AS games FROM match_participants " +
        "WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-02-01' " +
        "GROUP BY champion",
    );
    expect(plan.timeWindow).toEqual({
      kind: "calendar",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      timezone: "America/Los_Angeles",
    });
    expect(plan.where).toBeUndefined();
  });

  test("a boolean column filter lowers to an explicit comparison", () => {
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE win AND ${BOUND} GROUP BY player`,
    );
    expect(plan.where).toEqual({
      kind: "compare",
      op: "=",
      left: { kind: "column", column: "win" },
      right: { kind: "literal", value: true },
    });
  });
});

// ── Properties ───────────────────────────────────────────────────────────────

// mulberry32 — a tiny seeded PRNG so the fuzz corpus is reproducible.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("properties", () => {
  test("compilation succeeds exactly when there is no error diagnostic", () => {
    for (const expectation of CORPUS) {
      const analysis = analyzeScoutQl(expectation.query);
      const hasError = analysis.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      let compiled = true;
      try {
        compileScoutQl(expectation.query);
      } catch {
        compiled = false;
      }
      expect(compiled).toBe(!hasError);
    }
  });

  test("analysis never throws on seeded mutations of the corpus", () => {
    const random = mulberry32(0x5c_00_7a_11);
    const alphabet = "'()*,%::<>=!-. \nSELECTFROMWHEREGROUPBYRENDER0123456789";
    for (const expectation of CORPUS) {
      for (let round = 0; round < 40; round++) {
        let mutated = expectation.query;
        const operations = 1 + Math.floor(random() * 3);
        for (let step = 0; step < operations; step++) {
          const at = Math.floor(random() * (mutated.length + 1));
          const to = Math.min(mutated.length, at + Math.floor(random() * 24));
          const roll = random();
          if (roll < 0.4) {
            mutated = mutated.slice(0, at) + mutated.slice(to);
          } else if (roll < 0.7) {
            mutated =
              mutated.slice(0, at) +
              mutated.slice(at, to) +
              mutated.slice(at, to) +
              mutated.slice(to);
          } else {
            const character =
              alphabet[Math.floor(random() * alphabet.length)] ?? "?";
            mutated = mutated.slice(0, at) + character + mutated.slice(at);
          }
        }
        const analysis = analyzeScoutQl(mutated);
        expect(Array.isArray(analysis.diagnostics)).toBe(true);
      }
    }
  });

  test("every diagnostic span lies inside the query text", () => {
    for (const expectation of CORPUS) {
      const analysis = analyzeScoutQl(expectation.query);
      for (const diagnostic of analysis.diagnostics) {
        expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.span.end).toBeLessThanOrEqual(
          expectation.query.length,
        );
        expect(diagnostic.span.end).toBeGreaterThanOrEqual(
          diagnostic.span.start,
        );
      }
    }
  });
});
