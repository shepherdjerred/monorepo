import { match } from "ts-pattern";
import {
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
  ReportMetricSchema,
} from "#src/model/report-query-spec.ts";
import {
  type QueueType,
  QueueTypeSchema,
  queueTypeToDisplayString,
} from "#src/model/state.ts";

// ── Report query language registry ───────────────────────────────────────────
// Human-facing metadata describing every part of the query language. This is the
// single source that powers Monaco autocomplete + hover, the in-app docs, and
// the friendly column headers in the live preview. Adding a column/operator that
// is already grammar-expressible should only require editing this file.

export type ReportMetricKind = "count" | "rate" | "ratio" | "score";

export type ReportSourceInfo = {
  id: ReportSource;
  label: string;
  description: string;
  validGroupBys: ReportGroupBy[];
};

export type ReportMetricInfo = {
  id: ReportMetric;
  label: string;
  description: string;
  kind: ReportMetricKind;
};

export type ReportGroupByInfo = {
  id: ReportGroupBy;
  label: string;
  // Header shown for the grouping ("label") column when grouped by this field.
  columnLabel: string;
  description: string;
};

export type ReportKeywordInfo = {
  keyword: string;
  description: string;
};

export type ReportFilterInfo = {
  id: string;
  syntax: string;
  description: string;
};

export type ReportExampleInfo = {
  title: string;
  query: string;
};

export const REPORT_SOURCES: ReportSourceInfo[] = [
  {
    id: "match_participants",
    label: "Match participants",
    description:
      "Per-player match facts over the lookback window (one row per player per match).",
    validGroupBys: ["player", "champion", "queue"],
  },
  {
    id: "prematch_participants",
    label: "Prematch participants",
    description:
      "Champion-select / lobby observations — who queued up as what, before the game.",
    validGroupBys: ["player", "champion", "queue"],
  },
  {
    id: "player_pairs",
    label: "Player pairs",
    description:
      "Co-player statistics for teammates who played together. Requires GROUP BY pair.",
    validGroupBys: ["pair"],
  },
  {
    id: "rank_current",
    label: "Current rank",
    description:
      "Latest rank snapshot leaderboard for a competition's participants.",
    validGroupBys: ["player"],
  },
  {
    id: "competition_match_participants",
    label: "Competition match participants",
    description:
      "Match facts scoped to a competition's participants and date window. Requires competition_id.",
    validGroupBys: ["player", "champion", "queue"],
  },
  {
    id: "competition_rank",
    label: "Competition rank",
    description:
      "Competition leaderboard ordered by rank / score. Requires competition_id.",
    validGroupBys: ["player"],
  },
];

export const REPORT_METRICS: ReportMetricInfo[] = [
  {
    id: "games",
    label: "Games",
    description: "Number of games played.",
    kind: "count",
  },
  { id: "wins", label: "Wins", description: "Number of wins.", kind: "count" },
  {
    id: "losses",
    label: "Losses",
    description: "Number of losses (games − wins).",
    kind: "count",
  },
  {
    id: "surrenders",
    label: "Surrenders",
    description: "Number of games that ended in a surrender.",
    kind: "count",
  },
  {
    id: "surrender_rate",
    label: "Surrender rate",
    description: "Fraction of games that ended in a surrender (0–1).",
    kind: "rate",
  },
  {
    id: "win_rate",
    label: "Win rate",
    description: "Fraction of games won (0–1).",
    kind: "rate",
  },
  { id: "kills", label: "Kills", description: "Total kills.", kind: "count" },
  {
    id: "deaths",
    label: "Deaths",
    description: "Total deaths.",
    kind: "count",
  },
  {
    id: "assists",
    label: "Assists",
    description: "Total assists.",
    kind: "count",
  },
  {
    id: "kda",
    label: "KDA",
    description: "(kills + assists) / deaths (or takedowns when deaths = 0).",
    kind: "ratio",
  },
  {
    id: "creep_score",
    label: "Creep score",
    description: "Total minions/monsters killed (CS).",
    kind: "count",
  },
  {
    id: "damage_to_champions",
    label: "Damage to champions",
    description: "Total damage dealt to enemy champions.",
    kind: "count",
  },
  {
    id: "prematches",
    label: "Prematches",
    description:
      "Number of prematch observations (alias of games for prematch_participants).",
    kind: "count",
  },
  {
    id: "score",
    label: "Score",
    description:
      "Competition score / rank value (context-dependent for rank sources).",
    kind: "score",
  },
];

export const REPORT_GROUP_BYS: ReportGroupByInfo[] = [
  {
    id: "player",
    label: "Player",
    columnLabel: "Player",
    description: "Group rows by individual player.",
  },
  {
    id: "champion",
    label: "Champion",
    columnLabel: "Champion",
    description: "Group rows by champion.",
  },
  {
    id: "queue",
    label: "Queue",
    columnLabel: "Queue",
    description: "Group rows by queue type.",
  },
  {
    id: "pair",
    label: "Pair",
    columnLabel: "Pair",
    description: "Group rows by teammate pair (player_pairs only).",
  },
];

export const REPORT_KEYWORDS: ReportKeywordInfo[] = [
  { keyword: "SELECT", description: "Choose the metrics (columns) to report." },
  { keyword: "FROM", description: "Choose the data source (table)." },
  { keyword: "WHERE", description: "Filter rows (AND-joined clauses)." },
  { keyword: "GROUP BY", description: "Aggregate rows by a grouping field." },
  { keyword: "ORDER BY", description: "Sort by a metric or label." },
  { keyword: "LIMIT", description: "Cap the number of rows returned." },
  { keyword: "AND", description: "Combine multiple WHERE clauses." },
  {
    keyword: "IN",
    description: "Match against a list of values, e.g. queue IN (solo, flex).",
  },
  { keyword: "ASC", description: "Sort ascending." },
  { keyword: "DESC", description: "Sort descending (default)." },
  {
    keyword: "RENDER",
    description: "Choose how the report displays, e.g. RENDER bar_chart.",
  },
  {
    keyword: "WITH",
    description:
      "Set chart channels/options, e.g. WITH (y = win_rate, title = \"…\").",
  },
];

export type ReportRenderKindInfo = {
  id: string;
  label: string;
  description: string;
  isChart: boolean;
};

// The display kinds accepted by the trailing `RENDER <kind>` clause. Chart kinds
// additionally accept a `WITH (…)` clause to pick channels/options.
export const REPORT_RENDER_KINDS: ReportRenderKindInfo[] = [
  { id: "table", label: "Table", description: "Plain data table.", isChart: false },
  { id: "list", label: "List", description: "Bulleted text list.", isChart: false },
  {
    id: "leaderboard",
    label: "Leaderboard",
    description: "Ranked leaderboard text.",
    isChart: false,
  },
  {
    id: "bar_chart",
    label: "Bar chart",
    description: "Bar chart image; WITH (y = <metric>) picks the series.",
    isChart: true,
  },
  {
    id: "line_chart",
    label: "Line chart",
    description: "Line chart image; WITH (y = <metric>) picks the series.",
    isChart: true,
  },
];

export const REPORT_FILTERS: ReportFilterInfo[] = [
  {
    id: "queue",
    syntax: "queue IN (solo, flex, …)",
    description: "Restrict to specific queue types.",
  },
  {
    id: "champion_id",
    syntax: "champion_id = <number>",
    description: "Restrict to a single champion by numeric id.",
  },
  {
    id: "games",
    syntax: "games >= <number>",
    description: "Only include groups with at least N games.",
  },
  {
    id: "competition_id",
    syntax: "competition_id = <number>",
    description: "Scope competition-backed sources to a competition.",
  },
];

export const REPORT_EXAMPLES: ReportExampleInfo[] = [
  {
    title: "Most games played",
    query:
      "select games, win_rate from match_participants group by player order by games desc limit 10 render leaderboard",
  },
  {
    title: "Best win rate (ranked solo, min 10 games)",
    query:
      "select games, win_rate from match_participants where queue in (solo) and games >= 10 group by player order by win_rate desc render bar_chart with (y = win_rate)",
  },
  {
    title: "Surrender-happy champions",
    query:
      "select games, surrender_rate from match_participants group by champion order by surrender_rate desc limit 10 render leaderboard",
  },
];

export type ReportQueueValueInfo = {
  id: QueueType;
  label: string;
};

export function reportQueueValues(): ReportQueueValueInfo[] {
  return QueueTypeSchema.options.map((id) => ({
    id,
    label: queueTypeToDisplayString(id),
  }));
}

// ── Friendly-name helpers ────────────────────────────────────────────────────

export function reportGroupByColumnLabel(groupBy: ReportGroupBy): string {
  return match(groupBy)
    .with("player", () => "Player")
    .with("champion", () => "Champion")
    .with("queue", () => "Queue")
    .with("pair", () => "Pair")
    .exhaustive();
}

export function reportMetricLabel(metric: ReportMetric): string {
  return REPORT_METRICS.find((info) => info.id === metric)?.label ?? metric;
}

// Friendly header for a result column id. The first column is the grouping
// ("label") column; the rest are metric ids (or "rank" for highest-rank
// competition reports, which is not in the metric enum).
export function reportColumnLabel(
  column: string,
  groupBy: ReportGroupBy,
): string {
  if (column === "label") {
    return reportGroupByColumnLabel(groupBy);
  }
  const metric = ReportMetricSchema.safeParse(column);
  if (metric.success) {
    return reportMetricLabel(metric.data);
  }
  // Fallback: humanize unknown columns (e.g. "rank") — snake_case → Title case.
  return column
    .split("_")
    .map((part) => {
      const first = part.at(0);
      return first === undefined ? part : first.toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function reportSourceInfo(source: ReportSource): ReportSourceInfo {
  const info = REPORT_SOURCES.find((entry) => entry.id === source);
  if (info === undefined) {
    // Registry is exhaustive over the enum; this guards against drift.
    throw new Error(`Missing report source registry entry: ${source}`);
  }
  return info;
}
