// ── ScoutQL function registry ────────────────────────────────────────────────
// Every callable name the language accepts, with the metadata the editor
// services need (signature help, hover docs, completion snippets) and the
// structural facts the analyzer enforces (arity, star/DISTINCT/FILTER
// acceptance). Result typing itself lives in analyze-expr.ts — the registry
// carries the human-readable rule.

export type ScoutQlFunctionKind =
  "aggregate" | "scalar" | "macro" | "reference";

export type ScoutQlFunctionParam = { label: string; doc: string };

export type ScoutQlFunctionSignature = {
  /** Display form, e.g. `ROUND(x, digits)`. */
  label: string;
  params: ScoutQlFunctionParam[];
};

export type ScoutQlFunctionInfo = {
  name: string;
  kind: ScoutQlFunctionKind;
  signatures: ScoutQlFunctionSignature[];
  /** Human-readable result-type rule (docs / hover). */
  resultType: string;
  docMarkdown: string;
  /** Monaco snippet body; absent when the plain name suffices. */
  snippet?: string | undefined;
  minArgs: number;
  maxArgs: number;
  acceptsStar: boolean;
  acceptsDistinct: boolean;
  acceptsFilter: boolean;
};

function fn(
  info: Omit<
    ScoutQlFunctionInfo,
    "acceptsStar" | "acceptsDistinct" | "acceptsFilter"
  > &
    Partial<
      Pick<
        ScoutQlFunctionInfo,
        "acceptsStar" | "acceptsDistinct" | "acceptsFilter"
      >
    >,
): ScoutQlFunctionInfo {
  return {
    acceptsStar: false,
    acceptsDistinct: false,
    acceptsFilter: false,
    ...info,
  };
}

function param(label: string, doc: string): ScoutQlFunctionParam {
  return { label, doc };
}

const AGGREGATE_FILTER_NOTE =
  "\n\nSupports `FILTER (WHERE …)` for conditional aggregation.";

export const SCOUTQL_FUNCTIONS: readonly ScoutQlFunctionInfo[] = [
  fn({
    name: "count",
    kind: "aggregate",
    signatures: [
      { label: "COUNT(*)", params: [] },
      { label: "COUNT(x)", params: [param("x", "Counts non-NULL values.")] },
      {
        label: "COUNT(DISTINCT x)",
        params: [param("x", "Counts distinct non-NULL values.")],
      },
    ],
    resultType: "BIGINT",
    docMarkdown:
      "Row count. `COUNT(*)` counts rows, `COUNT(x)` non-NULL values, `COUNT(DISTINCT x)` distinct values." +
      AGGREGATE_FILTER_NOTE,
    snippet: "COUNT(*)",
    minArgs: 0,
    maxArgs: 1,
    acceptsStar: true,
    acceptsDistinct: true,
    acceptsFilter: true,
  }),
  fn({
    name: "sum",
    kind: "aggregate",
    signatures: [
      { label: "SUM(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "BIGINT for integer input, DOUBLE otherwise",
    docMarkdown:
      "Sum of a numeric expression. Booleans need an explicit cast: `SUM(win::INT)`." +
      AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "avg",
    kind: "aggregate",
    signatures: [
      { label: "AVG(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "DOUBLE",
    docMarkdown:
      "Arithmetic mean. Rates are `AVG(flag::INT)` — e.g. `AVG(win::INT)` is the win rate." +
      AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "min",
    kind: "aggregate",
    signatures: [
      { label: "MIN(x)", params: [param("x", "Any orderable expression.")] },
    ],
    resultType: "same as the argument",
    docMarkdown: "Smallest value." + AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "max",
    kind: "aggregate",
    signatures: [
      { label: "MAX(x)", params: [param("x", "Any orderable expression.")] },
    ],
    resultType: "same as the argument",
    docMarkdown: "Largest value." + AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "median",
    kind: "aggregate",
    signatures: [
      { label: "MEDIAN(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "DOUBLE",
    docMarkdown: "Median (50th percentile)." + AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "quantile_cont",
    kind: "aggregate",
    signatures: [
      {
        label: "QUANTILE_CONT(x, q)",
        params: [
          param("x", "Numeric expression."),
          param("q", "Fraction strictly between 0 and 1, e.g. 0.9."),
        ],
      },
    ],
    resultType: "DOUBLE",
    docMarkdown:
      "Continuous (interpolated) quantile — `QUANTILE_CONT(damage, 0.9)` is the 90th percentile." +
      AGGREGATE_FILTER_NOTE,
    snippet: "QUANTILE_CONT(${1:x}, ${2:0.9})",
    minArgs: 2,
    maxArgs: 2,
    acceptsFilter: true,
  }),
  fn({
    name: "stddev",
    kind: "aggregate",
    signatures: [
      { label: "STDDEV(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "DOUBLE",
    docMarkdown: "Sample standard deviation." + AGGREGATE_FILTER_NOTE,
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "round",
    kind: "scalar",
    signatures: [
      {
        label: "ROUND(x[, digits])",
        params: [
          param("x", "Numeric expression."),
          param("digits", "Decimal places (integer literal, default 0)."),
        ],
      },
    ],
    resultType: "DOUBLE",
    docMarkdown: "Round to a number of decimal places.",
    minArgs: 1,
    maxArgs: 2,
  }),
  fn({
    name: "floor",
    kind: "scalar",
    signatures: [
      { label: "FLOOR(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "same numeric class as the argument",
    docMarkdown:
      "Round down. `FLOOR(x / w) * w` is the bucketing idiom for histograms.",
    minArgs: 1,
    maxArgs: 1,
  }),
  fn({
    name: "ceil",
    kind: "scalar",
    signatures: [
      { label: "CEIL(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "same numeric class as the argument",
    docMarkdown: "Round up.",
    minArgs: 1,
    maxArgs: 1,
  }),
  fn({
    name: "abs",
    kind: "scalar",
    signatures: [
      { label: "ABS(x)", params: [param("x", "Numeric expression.")] },
    ],
    resultType: "same as the argument",
    docMarkdown: "Absolute value.",
    minArgs: 1,
    maxArgs: 1,
  }),
  fn({
    name: "coalesce",
    kind: "scalar",
    signatures: [
      {
        label: "COALESCE(a, b, …)",
        params: [
          param("a", "First candidate."),
          param("b", "Fallback when earlier arguments are NULL."),
        ],
      },
    ],
    resultType: "common type of the arguments",
    docMarkdown: "First non-NULL argument.",
    minArgs: 2,
    maxArgs: 8,
  }),
  fn({
    name: "nullif",
    kind: "scalar",
    signatures: [
      {
        label: "NULLIF(a, b)",
        params: [
          param("a", "Value to return."),
          param("b", "Value that maps to NULL."),
        ],
      },
    ],
    resultType: "type of the first argument",
    docMarkdown:
      "NULL when `a = b`, else `a`. `x / NULLIF(y, 0)` avoids division by zero.",
    minArgs: 2,
    maxArgs: 2,
  }),
  fn({
    name: "greatest",
    kind: "scalar",
    signatures: [
      {
        label: "GREATEST(a, b, …)",
        params: [param("a", "First value."), param("b", "Further values.")],
      },
    ],
    resultType: "common type of the arguments",
    docMarkdown: "Row-wise maximum of its arguments.",
    minArgs: 2,
    maxArgs: 8,
  }),
  fn({
    name: "least",
    kind: "scalar",
    signatures: [
      {
        label: "LEAST(a, b, …)",
        params: [param("a", "First value."), param("b", "Further values.")],
      },
    ],
    resultType: "common type of the arguments",
    docMarkdown: "Row-wise minimum of its arguments.",
    minArgs: 2,
    maxArgs: 8,
  }),
  fn({
    name: "date_trunc",
    kind: "scalar",
    signatures: [
      {
        label: "DATE_TRUNC('day'|'week'|'month', ts)",
        params: [
          param("part", "String literal: 'day', 'week', or 'month'."),
          param("ts", "Timestamp column, optionally `AT TIME ZONE '…'`."),
        ],
      },
    ],
    resultType: "TIMESTAMP",
    docMarkdown:
      "Truncate a timestamp to a calendar bucket. Time-series queries `GROUP BY DATE_TRUNC('week', game_creation_at)`.",
    snippet: "DATE_TRUNC('${1|day,week,month|}', ${2:game_creation_at})",
    minArgs: 2,
    maxArgs: 2,
  }),
  fn({
    name: "kda",
    kind: "macro",
    signatures: [{ label: "kda()", params: [] }],
    resultType: "DOUBLE",
    docMarkdown:
      "Aggregate KDA: `(SUM(kills) + SUM(assists)) / GREATEST(SUM(deaths), 1)` — a perfect KDA shows takedowns." +
      AGGREGATE_FILTER_NOTE,
    snippet: "kda()",
    minArgs: 0,
    maxArgs: 0,
    acceptsFilter: true,
  }),
  fn({
    name: "per_minute",
    kind: "macro",
    signatures: [
      {
        label: "per_minute(x)",
        params: [param("x", "Numeric counter, e.g. creep_score.")],
      },
    ],
    resultType: "DOUBLE",
    docMarkdown:
      "Rate per minute played: `SUM(x) / NULLIF(SUM(time_played) / 60, 0)`." +
      AGGREGATE_FILTER_NOTE,
    snippet: "per_minute(${1:creep_score})",
    minArgs: 1,
    maxArgs: 1,
    acceptsFilter: true,
  }),
  fn({
    name: "player",
    kind: "reference",
    signatures: [
      {
        label: "player('name')",
        params: [param("name", "Tracked player alias or Riot ID.")],
      },
    ],
    resultType: "BOOLEAN (WHERE only)",
    docMarkdown:
      "Filter to one tracked player's rows: `WHERE player('Bob')` (or `WHERE player = player('Bob')`). The name resolves at run time.",
    snippet: "player('${1:name}')",
    minArgs: 1,
    maxArgs: 1,
  }),
  fn({
    name: "champion",
    kind: "reference",
    signatures: [
      {
        label: "champion('Name')",
        params: [param("Name", "Champion display name, e.g. 'Kai''Sa'.")],
      },
    ],
    resultType: "INTEGER constant (a champion_id)",
    docMarkdown:
      "Resolve a champion display name to its numeric id at compile time: `WHERE champion_id = champion('Jinx')`.",
    snippet: "champion('${1:Name}')",
    minArgs: 1,
    maxArgs: 1,
  }),
];

const FUNCTIONS_BY_NAME = new Map<string, ScoutQlFunctionInfo>(
  SCOUTQL_FUNCTIONS.map((info) => [info.name, info]),
);

export function scoutQlFunction(name: string): ScoutQlFunctionInfo | undefined {
  return FUNCTIONS_BY_NAME.get(name.toLowerCase());
}

// ── Did-you-mean (Levenshtein) ───────────────────────────────────────────────
// Same edit-distance heuristic as the champion resolver (threshold scales with
// the misspelling's length); reimplemented here so the language layer never
// imports legacy report-query modules.

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

/**
 * Closest candidate by edit distance, or undefined when nothing is close
 * enough to suggest (threshold: max(2, ⌊len/3⌋)).
 */
export function closestScoutQlName(
  name: string,
  candidates: Iterable<string>,
): string | undefined {
  const normalized = name.toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(normalized, candidate.toLowerCase());
    if (best === undefined || distance < best.distance) {
      best = { candidate, distance };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  const threshold = Math.max(2, Math.floor(normalized.length / 3));
  return best.distance <= threshold ? best.candidate : undefined;
}

export function closestScoutQlFunctionName(name: string): string | undefined {
  return closestScoutQlName(name, FUNCTIONS_BY_NAME.keys());
}
