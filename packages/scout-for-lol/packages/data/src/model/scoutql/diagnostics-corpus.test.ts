import { describe, expect, test } from "vitest";
import { REPORT_QUERY_MAX_LENGTH } from "#src/model/report.ts";
import {
  SCOUTQL_DIAGNOSTIC_CODES,
  ScoutQlError,
  type ScoutQlDiagnosticCode,
} from "#src/model/scoutql/diagnostics.ts";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";

// ── Negative corpus ──────────────────────────────────────────────────────────
// One case per diagnostic code, with a registry-completeness assertion at the
// end: a code that no query can produce cannot exist, and a check that emits an
// undocumented code cannot ship. Cases pin CODES, never message prose, so the
// wording stays free to improve.

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

type NegativeCase = {
  name: string;
  query: string;
  code: ScoutQlDiagnosticCode;
};

const DEEP_NESTING = `SELECT COUNT(*) AS g FROM match_participants WHERE ${"(".repeat(40)}kills > 1${")".repeat(40)}`;

const LONG_EXPRESSION = `SELECT ${Array.from({ length: 300 }, () => "kills").join(" + ")} AS x FROM match_participants GROUP BY player`;

const TOO_LONG = `SELECT COUNT(*) AS g FROM match_participants WHERE queue = '${"x".repeat(REPORT_QUERY_MAX_LENGTH)}'`;

const LONG_IN_LIST = `SELECT COUNT(*) AS g FROM match_participants WHERE champion_id IN (${Array.from(
  { length: 51 },
  (_, index) => String(index + 1),
).join(", ")}) AND ${BOUND} GROUP BY player`;

const TOO_MANY_OUTPUTS = `SELECT ${Array.from(
  { length: 21 },
  (_, index) => `COUNT(*) AS c${String(index)}`,
).join(", ")} FROM match_participants WHERE ${BOUND}`;

export const NEGATIVE_CASES: NegativeCase[] = [
  // Lexing / parsing
  {
    name: "unterminated string literal",
    query: "SELECT COUNT(*) AS g FROM match_participants WHERE queue = 'solo",
    code: "lex-error",
  },
  {
    name: "missing SELECT item",
    query: "SELECT FROM match_participants",
    code: "parse-error",
  },
  {
    name: "double-quoted string",
    query: 'SELECT COUNT(*) AS g FROM match_participants WHERE queue = "solo"',
    code: "string-double-quoted",
  },
  {
    name: "CASE points at FILTER instead",
    query: "SELECT CASE WHEN win THEN 1 END AS x FROM match_participants",
    code: "case-unsupported",
  },
  {
    name: "query over the length cap",
    query: TOO_LONG,
    code: "query-too-long",
  },
  // Name resolution
  {
    name: "unknown source",
    query: "SELECT COUNT(*) AS g FROM matches",
    code: "unknown-source",
  },
  {
    name: "misspelled column",
    query: `SELECT SUM(kils) AS k FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "unknown-column",
  },
  {
    name: "unknown function",
    query: `SELECT total(kills) AS k FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "unknown-function",
  },
  {
    name: "per_game is gone",
    query: `SELECT per_game(kills) AS k FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "unknown-function",
  },
  {
    name: "queue value Scout never records",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE queue = 'ranked' AND ${BOUND} GROUP BY player`,
    code: "unknown-queue",
  },
  {
    name: "misspelled champion",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE champion_id = champion('Jinxx') AND ${BOUND} GROUP BY player`,
    code: "champion-unknown",
  },
  // Typing
  {
    name: "comparing a number with text",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE kills > 'x' AND ${BOUND} GROUP BY player`,
    code: "type-mismatch",
  },
  {
    name: "AVG over a boolean needs the cast",
    query: `SELECT AVG(win) AS r FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "aggregate-over-boolean",
  },
  {
    name: "unknown cast target",
    query: `SELECT AVG(win::FOO) AS r FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "cast-type-invalid",
  },
  {
    name: "unknown interval unit",
    query:
      "SELECT COUNT(*) AS g FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 FORTNIGHT GROUP BY player",
    code: "interval-unit-invalid",
  },
  {
    name: "wrong argument count",
    query: `SELECT ROUND() AS r FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "function-arity",
  },
  {
    name: "quantile fraction outside (0, 1)",
    query: `SELECT QUANTILE_CONT(kills, 1.5) AS x FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "quantile-out-of-range",
  },
  {
    name: "DISTINCT outside COUNT",
    query: `SELECT SUM(DISTINCT kills) AS x FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "distinct-unsupported",
  },
  {
    name: "casting an aggregate result",
    query: `SELECT SUM(kills)::DOUBLE AS x FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "cast-around-aggregate",
  },
  // Aggregation context
  {
    name: "aggregate in WHERE",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE COUNT(*) > 5 AND ${BOUND} GROUP BY player`,
    code: "aggregate-in-where",
  },
  {
    name: "an output alias used in WHERE suggests HAVING",
    query: `SELECT COUNT(*) AS games FROM match_participants WHERE games >= 10 AND ${BOUND} GROUP BY player`,
    code: "aggregate-in-where",
  },
  {
    name: "nested aggregate",
    query: `SELECT SUM(AVG(kills)) AS x FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "nested-aggregate",
  },
  {
    name: "column neither grouped nor aggregated",
    query: `SELECT champion, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player`,
    code: "column-not-grouped",
  },
  {
    name: "grand total with a raw column",
    query: `SELECT champion, COUNT(*) AS games FROM match_participants WHERE ${BOUND}`,
    code: "column-not-grouped",
  },
  {
    name: "GROUP BY an arbitrary expression",
    query: `SELECT kills * 2 AS doubled, COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY kills * 2`,
    code: "grouping-expression-invalid",
  },
  {
    name: "computed output without a name",
    query: `SELECT COUNT(*) FROM match_participants WHERE ${BOUND}`,
    code: "alias-required",
  },
  {
    name: "duplicate output name",
    query: `SELECT COUNT(*) AS g, SUM(kills) AS g FROM match_participants WHERE ${BOUND}`,
    code: "alias-duplicate",
  },
  {
    name: "output name over 64 characters",
    query: `SELECT COUNT(*) AS ${"a".repeat(65)} FROM match_participants WHERE ${BOUND}`,
    code: "alias-invalid",
  },
  {
    name: "HAVING names nothing",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player HAVING wins >= 10`,
    code: "having-target-unknown",
  },
  {
    name: "ORDER BY names nothing",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player ORDER BY nope DESC`,
    code: "order-target-unknown",
  },
  // Source rules
  {
    name: "time column on a snapshot source",
    query:
      "SELECT COUNT(*) AS g FROM rank_current WHERE game_creation_at > CURRENT_TIMESTAMP GROUP BY player",
    code: "time-column-unavailable",
  },
  {
    name: "player() where it cannot be resolved",
    query: `SELECT COUNT(*) AS g FROM player_groups WHERE player('Bob') AND ${BOUND} GROUP BY group(all)`,
    code: "player-ref-unavailable",
  },
  {
    name: "two players ANDed together",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE player('A') AND player('B') AND ${BOUND} GROUP BY player`,
    code: "player-ref-conflict",
  },
  {
    name: "competition source without competition_id",
    query: `SELECT COUNT(*) AS g FROM competition_match_participants WHERE ${BOUND} GROUP BY player`,
    code: "competition-id-required",
  },
  {
    name: "competition_id on a non-competition source",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE competition_id = 3 AND ${BOUND} GROUP BY player`,
    code: "competition-id-unavailable",
  },
  {
    name: "group() outside player_groups",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY group(all)`,
    code: "group-call-unavailable",
  },
  {
    name: "player_groups without group()",
    query: `SELECT COUNT(*) AS g FROM player_groups WHERE ${BOUND} GROUP BY player`,
    code: "group-call-unavailable",
  },
  {
    name: "per-member column filtered on player_groups",
    query: `SELECT COUNT(*) AS g FROM player_groups WHERE kills > 5 AND ${BOUND} GROUP BY group(all)`,
    code: "source-column-context",
  },
  // Time window
  {
    name: "no time bound at all",
    query: "SELECT COUNT(*) AS g FROM match_participants GROUP BY player",
    code: "time-window-unbounded",
  },
  {
    name: "calendar bound that is not a date",
    query:
      "SELECT COUNT(*) AS g FROM match_participants " +
      "WHERE (game_creation_at AT TIME ZONE 'UTC')::DATE BETWEEN 'nope' AND '2026-01-01' GROUP BY player",
    code: "time-window-invalid",
  },
  {
    name: "calendar bound that ends before it starts",
    query:
      "SELECT COUNT(*) AS g FROM match_participants " +
      "WHERE game_creation_at::DATE BETWEEN '2026-02-01' AND '2026-01-01' GROUP BY player",
    code: "time-window-invalid",
  },
  // Limits
  {
    name: "more than 20 outputs",
    query: TOO_MANY_OUTPUTS,
    code: "output-count",
  },
  {
    name: "more than 3 groupings",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player, champion, queue, lane`,
    code: "grouping-count",
  },
  {
    name: "more than 3 order keys",
    query: `SELECT COUNT(*) AS g, SUM(kills) AS k, SUM(deaths) AS d, SUM(assists) AS a FROM match_participants WHERE ${BOUND} GROUP BY player ORDER BY g, k, d, a`,
    code: "order-key-count",
  },
  {
    name: "IN list over 50 items",
    query: LONG_IN_LIST,
    code: "in-list-too-long",
  },
  {
    name: "parentheses nested past the cap",
    query: DEEP_NESTING,
    code: "expression-too-deep",
  },
  {
    name: "expression with too many nodes",
    query: LONG_EXPRESSION,
    code: "expression-too-large",
  },
  {
    name: "LIMIT 0",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player LIMIT 0`,
    code: "limit-invalid",
  },
  // Render
  {
    name: "unknown render kind",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player RENDER pie_chart`,
    code: "unknown-render-kind",
  },
  {
    name: "unknown render option",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player RENDER table WITH (nope = true)`,
    code: "unknown-render-option",
  },
  {
    name: "render option of the wrong type",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player RENDER bar_chart WITH (smooth = 3)`,
    code: "render-option-invalid",
  },
  {
    name: "cumulative over a non-additive output",
    query: `SELECT AVG(win::INT) AS win_rate FROM match_participants WHERE ${BOUND} GROUP BY player RENDER line_chart WITH (y = win_rate, cumulative = true)`,
    code: "render-option-invalid",
  },
  {
    name: "percent stacking on a kind that does not stack",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY player RENDER bar_chart WITH (stack = percent)`,
    code: "render-option-invalid",
  },
  {
    name: "rolling and cumulative together",
    query: `SELECT SUM(kills) AS k FROM match_participants WHERE ${BOUND} GROUP BY player RENDER line_chart WITH (y = k, rolling = 4, cumulative = true)`,
    code: "render-option-invalid",
  },
  {
    name: "heatmap needs two dimensions",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER heatmap`,
    code: "render-shape-invalid",
  },
  {
    name: "histogram needs a bucket grouping",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER histogram`,
    code: "render-shape-invalid",
  },
  {
    name: "box plot needs five outputs",
    query: `SELECT MIN(kills) AS low, MAX(kills) AS high FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER box_plot`,
    code: "render-shape-invalid",
  },
  {
    name: "render channel naming nothing",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER bar_chart WITH (y = nope)`,
    code: "render-channel-unknown",
  },
  {
    name: "compare without a temporal grouping",
    query: `SELECT COUNT(*) AS g FROM match_participants WHERE ${BOUND} GROUP BY champion RENDER line_chart WITH (compare = previous_period)`,
    code: "render-compare-unavailable",
  },
  {
    name: "compare without a stated window",
    query:
      "SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS g FROM match_participants " +
      "GROUP BY DATE_TRUNC('week', game_creation_at) RENDER line_chart WITH (compare = previous_period)",
    code: "render-compare-unavailable",
  },
];

describe("negative corpus: one case per diagnostic code", () => {
  for (const negative of NEGATIVE_CASES) {
    test(`${negative.code}: ${negative.name}`, () => {
      const analysis = analyzeScoutQl(negative.query);
      const codes = analysis.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain(negative.code);
    });
  }
});

describe("the diagnostic registry is exactly what the corpus produces", () => {
  test("every registered code has a negative case", () => {
    const covered = new Set<string>();
    for (const negative of NEGATIVE_CASES) {
      for (const diagnostic of analyzeScoutQl(negative.query).diagnostics) {
        covered.add(diagnostic.code);
      }
    }
    const uncovered = SCOUTQL_DIAGNOSTIC_CODES.filter(
      (code) => !covered.has(code),
    );
    expect(uncovered).toEqual([]);
  });

  test("no case produces a code outside the registry", () => {
    const registry = new Set<string>(SCOUTQL_DIAGNOSTIC_CODES);
    for (const negative of NEGATIVE_CASES) {
      for (const diagnostic of analyzeScoutQl(negative.query).diagnostics) {
        expect(registry.has(diagnostic.code)).toBe(true);
      }
    }
  });
});

describe("compilation refuses exactly the error-severity queries", () => {
  test("an error diagnostic means ScoutQlError, and vice versa", () => {
    for (const negative of NEGATIVE_CASES) {
      const analysis = analyzeScoutQl(negative.query);
      const hasError = analysis.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
      let thrown: unknown;
      try {
        compileScoutQl(negative.query);
      } catch (error) {
        thrown = error;
      }
      if (hasError) {
        expect(thrown).toBeInstanceOf(ScoutQlError);
      } else {
        expect(thrown).toBeUndefined();
      }
    }
  });

  test("the thrown error carries every diagnostic, warnings included", () => {
    let thrown: unknown;
    try {
      compileScoutQl(
        "SELECT AVG(win) AS r FROM match_participants GROUP BY player",
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScoutQlError);
    const codes =
      thrown instanceof ScoutQlError
        ? thrown.diagnostics.map((diagnostic) => diagnostic.code)
        : [];
    expect(codes).toContain("aggregate-over-boolean");
    expect(codes).toContain("time-window-unbounded");
  });
});

describe("quick fixes", () => {
  test("AVG over a boolean offers the ::INT cast", () => {
    const analysis = analyzeScoutQl(
      `SELECT AVG(win) AS r FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    const diagnostic = analysis.diagnostics.find(
      (candidate) => candidate.code === "aggregate-over-boolean",
    );
    const [fix] = diagnostic?.fixes ?? [];
    expect(fix?.edits).toEqual([
      {
        start: "SELECT AVG(win".length,
        end: "SELECT AVG(win".length,
        newText: "::INT",
      },
    ]);
  });

  test("an unbounded query offers a 30-day bound", () => {
    const query =
      "SELECT COUNT(*) AS g FROM match_participants GROUP BY player";
    const analysis = analyzeScoutQl(query);
    const diagnostic = analysis.diagnostics.find(
      (candidate) => candidate.code === "time-window-unbounded",
    );
    const [fix] = diagnostic?.fixes ?? [];
    const [edit] = fix?.edits ?? [];
    expect(edit?.newText).toBe(
      " WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY",
    );
    const repaired =
      query.slice(0, edit?.start ?? 0) +
      (edit?.newText ?? "") +
      query.slice(edit?.end ?? 0);
    expect(
      analyzeScoutQl(repaired).diagnostics.map((candidate) => candidate.code),
    ).toEqual([]);
  });

  test("an unnamed output offers a derived alias that then compiles", () => {
    const query = `SELECT COUNT(*) FROM match_participants WHERE ${BOUND}`;
    const analysis = analyzeScoutQl(query);
    const diagnostic = analysis.diagnostics.find(
      (candidate) => candidate.code === "alias-required",
    );
    const [edit] = diagnostic?.fixes?.[0]?.edits ?? [];
    const repaired =
      query.slice(0, edit?.start ?? 0) +
      (edit?.newText ?? "") +
      query.slice(edit?.end ?? 0);
    expect(repaired).toContain("AS games");
    expect(analyzeScoutQl(repaired).diagnostics).toEqual([]);
  });
});
