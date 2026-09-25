// ── ScoutQL idioms — one cookbook, four consumers ────────────────────────────
// These recipes are the answer to "how do I ask X in ScoutQL?", and they are
// deliberately a SINGLE module because four surfaces need them and a fork
// between any two is invisible until someone is misled:
//
//   * the docs cookbook page (how-to/scoutql-recipes)
//   * the in-app query reference
//   * editor completions (the `snippet` bodies below)
//   * both AI prompts (Explore and the report-query agent field guide)
//
// Every `query` is canonically formatted, compiles, and lints without an
// error-severity diagnostic — the idiom test asserts all three, so a recipe
// cannot rot into something the language no longer accepts.

/** A completion snippet, in Monaco/LSP snippet syntax (`${1:placeholder}`). */
export type ScoutQlIdiomSnippet = {
  /** The clause whose expression positions offer it. */
  clause: "select" | "where";
  body: string;
};

export type ScoutQlIdiom = {
  id: string;
  title: string;
  description: string;
  /** A complete, runnable query demonstrating the idiom. */
  query: string;
  /** The reusable fragment, when the idiom has one. */
  snippet?: ScoutQlIdiomSnippet;
};

export const SCOUTQL_IDIOMS: readonly ScoutQlIdiom[] = [
  {
    id: "win-rate",
    title: "Win rate",
    description:
      "A rate is the average of a boolean cast to an integer. DuckDB will not average a BOOLEAN, so the `::INT` is required — and it is what makes the value a percentage rather than a count.",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
HAVING games >= 10
ORDER BY win_rate DESC
RENDER leaderboard`,
    snippet: { clause: "select", body: "AVG(win::INT) AS win_rate" },
  },
  {
    id: "conditional-aggregate",
    title: "Conditional aggregate with FILTER",
    description:
      "`FILTER (WHERE …)` narrows one aggregate without narrowing the query, so wins, losses, and a solo-queue win rate can share a single pass over the same rows.",
    query: `SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses, AVG(win::INT) FILTER (WHERE queue = 'solo') AS solo_win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player`,
    snippet: {
      clause: "select",
      body: "COUNT(*) FILTER (WHERE ${1:condition}) AS ${2:name}",
    },
  },
  {
    id: "percentiles",
    title: "Medians and percentiles",
    description:
      '`MEDIAN(x)` and `QUANTILE_CONT(x, q)` describe a distribution\'s shape where an average hides it — a 90th-percentile damage number answers "how big are the big games?".',
    query: `SELECT MEDIAN(total_damage_dealt_to_champions) AS median_damage, QUANTILE_CONT(total_damage_dealt_to_champions, 0.9) AS p90
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY champion
ORDER BY p90 DESC
LIMIT 10`,
    snippet: {
      clause: "select",
      body: "QUANTILE_CONT(${1:column}, ${2:0.9}) AS ${3:p90}",
    },
  },
  {
    id: "count-distinct",
    title: "Distinct counts",
    description:
      "`COUNT(DISTINCT x)` counts unique values — champion pool size, distinct queues played. It is not additive, so it cannot be accumulated across buckets.",
    query: `SELECT COUNT(*) AS games, COUNT(DISTINCT champion_id) AS champions
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY champions DESC`,
    snippet: {
      clause: "select",
      body: "COUNT(DISTINCT ${1:champion_id}) AS ${2:champions}",
    },
  },
  {
    id: "per-minute",
    title: "Per-minute rates and KDA",
    description:
      "`per_minute(x)` divides a summed counter by minutes played, guarding a zero denominator; `kda()` is takedowns over at-least-one death, so a deathless streak still ranks by takedowns.",
    query: `SELECT COUNT(*) AS games, per_minute(creep_score) AS cs_per_minute, kda() AS kda
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY cs_per_minute DESC`,
    snippet: {
      clause: "select",
      body: "per_minute(${1:creep_score}) AS ${2:cs_per_minute}",
    },
  },
  {
    id: "relative-window",
    title: "A rolling time bound",
    description:
      "A relative bound is an ordinary WHERE conjunct. Omitting it is legal and means every ingested game, which is rarely the question — state a window unless you mean all history.",
    query: `SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 7 DAY
GROUP BY player
ORDER BY games DESC`,
    snippet: {
      clause: "where",
      body: "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL ${1:30} DAY",
    },
  },
  {
    id: "calendar-window",
    title: "A calendar month, in a real time zone",
    description:
      "Calendar bounds compare dates, not instants: shift the timestamp into the zone the days are measured in, cast to DATE, and BETWEEN two ISO dates (both ends inclusive).",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY player`,
    snippet: {
      clause: "where",
      body: "(game_creation_at AT TIME ZONE '${1:UTC}')::DATE BETWEEN '${2:2026-01-01}' AND '${3:2026-01-31}'",
    },
  },
  {
    id: "weekly-trend",
    title: "A weekly trend",
    description:
      "Time series bucket with `DATE_TRUNC` in GROUP BY and echo the same expression in SELECT so the bucket has a name to plot and sort by.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games, smooth = true)`,
    snippet: {
      clause: "select",
      body: "DATE_TRUNC('${1|day,week,month|}', ${2:game_creation_at})",
    },
  },
  {
    id: "period-comparison",
    title: "This period against the last",
    description:
      "`compare = previous_period` re-runs the same aggregation over the equally long span immediately before the window and overlays it. It needs a stated window and a time bucket to line the two up.",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER stacked_bar WITH (y = (wins, losses), compare = previous_period)`,
  },
  {
    id: "histogram-buckets",
    title: "A distribution histogram",
    description:
      "Bucket a numeric column with `FLOOR(x / width) * width` and count rows per bucket. The multiplication keeps the bucket's real starting value, so the axis reads in the column's own units.",
    query: `SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY FLOOR(game_duration_seconds / 300) * 300
ORDER BY bucket ASC
RENDER histogram WITH (x = bucket, y = games)`,
    snippet: {
      clause: "select",
      body: "FLOOR(${1:game_duration_seconds} / ${2:300}) * ${2:300} AS ${3:bucket}",
    },
  },
  {
    id: "player-champion-filter",
    title: "One player, one champion",
    description:
      "`player('…')` resolves a tracked player's accounts at run time, and `champion('…')` folds a display name to its numeric id at compile time (misspellings get a suggestion).",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE player('Bob')
  AND champion_id = champion('Jinx')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY patch
ORDER BY patch ASC`,
    snippet: { clause: "where", body: "player('${1:name}')" },
  },
  {
    id: "box-plot",
    title: "A five-number summary",
    description:
      "Box plots take their five outputs explicitly, in the order min, q1, median, q3, max — the same explicit-SQL bargain as the rest of the language, so nothing is guessed from a column name.",
    query: `SELECT champion, MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY champion
LIMIT 8
RENDER box_plot WITH (y = (low, q1, med, q3, high))`,
  },
];

/** The snippet-bearing idioms offered at an expression position in `clause`. */
export function scoutQlIdiomSnippets(
  clause: "select" | "where",
): { idiom: ScoutQlIdiom; snippet: ScoutQlIdiomSnippet }[] {
  return SCOUTQL_IDIOMS.flatMap((idiom) =>
    idiom.snippet?.clause === clause ? [{ idiom, snippet: idiom.snippet }] : [],
  );
}
