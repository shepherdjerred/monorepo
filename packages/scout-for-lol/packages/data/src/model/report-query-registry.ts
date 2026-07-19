import { match } from "ts-pattern";
import {
  ReportMetricSchema,
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
} from "#src/model/report-query-spec.ts";
import { REPORT_METRICS } from "#src/model/report-query-metrics.ts";
import {
  type QueueType,
  QueueTypeSchema,
  queueTypeToDisplayString,
} from "#src/model/state.ts";

export type ReportSourceInfo = {
  id: ReportSource;
  label: string;
  description: string;
  validGroupBys: ReportGroupBy[];
};
export type ReportGroupByInfo = {
  id: ReportGroupBy;
  label: string;
  columnLabel: string;
  description: string;
};
export type ReportKeywordInfo = { keyword: string; description: string };
export type ReportFilterInfo = {
  id: string;
  syntax: string;
  description: string;
};
export type ReportFunctionInfo = {
  id: string;
  syntax: string;
  description: string;
};
export type ReportRenderOptionInfo = {
  id: string;
  syntax: string;
  description: string;
};
export type ReportRenderKindInfo = {
  id: string;
  label: string;
  description: string;
  isChart: boolean;
};

const MATCH_GROUP_BYS: ReportGroupBy[] = [
  "player",
  "champion",
  "queue",
  "team_position",
  "individual_position",
  "lane",
  "role",
  "game_mode",
  "game_type",
  "patch",
  "map",
  "outcome",
  "surrender_state",
  "arena_placement",
  "day",
  "week",
  "month",
  "all",
];

export const REPORT_SOURCES: ReportSourceInfo[] = [
  {
    id: "match_participants",
    label: "Match participants",
    description:
      "Per-player match facts over the lookback window (one row per player per match).",
    validGroupBys: MATCH_GROUP_BYS,
  },
  {
    id: "prematch_participants",
    label: "Prematch participants",
    description:
      "Champion-select / lobby observations — who queued up as what, before the game.",
    validGroupBys: ["player", "champion", "queue", "all"],
  },
  {
    id: "player_groups",
    label: "Player groups",
    description:
      "Teammate-group statistics (sizes 2-5; Arena groups by subteam). Requires GROUP BY group(N) or group(all); player_pairs + GROUP BY pair are legacy aliases for group(2).",
    validGroupBys: ["group"],
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
    validGroupBys: MATCH_GROUP_BYS,
  },
  {
    id: "competition_rank",
    label: "Competition rank",
    description:
      "Competition leaderboard ordered by rank / score. Requires competition_id.",
    validGroupBys: ["player"],
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
    id: "group",
    label: "Group",
    columnLabel: "Group",
    description:
      "Group rows by teammate group (player_groups only): GROUP BY group(N) for one size (N = 2-5) or group(all) for every size the roster supports. Stats sum members; a win requires every member to win. GROUP BY pair is the legacy alias for group(2).",
  },
  ...MATCH_GROUP_BYS.filter(
    (id) => !["player", "champion", "queue"].includes(id),
  ).map((id) => ({
    id,
    label: reportGroupByColumnLabel(id),
    columnLabel: reportGroupByColumnLabel(id),
    description: `Group rows by ${reportGroupByColumnLabel(id).toLowerCase()}.`,
  })),
];

const KEYWORD_DATA: [string, string][] = [
  ["SELECT", "Choose report outputs: metrics or bounded expressions."],
  ["FROM", "Choose the data source (table)."],
  ["WHERE", "Filter raw rows with AND-joined clauses."],
  ["AS", "Name a calculated SELECT output."],
  ["GROUP BY", "Aggregate by one or two dimensions."],
  ["HAVING", "Filter aggregated rows by a SELECT output or alias."],
  ["ORDER BY", "Sort by an output or label."],
  ["LIMIT", "Cap the number of rows returned."],
  ["AND", "Combine multiple WHERE or HAVING clauses."],
  ["IN", "Match against a list of values."],
  ["ASC", "Sort ascending."],
  ["DESC", "Sort descending (default)."],
  ["RENDER", "Choose the report display kind."],
  ["WITH", "Set chart channels and appearance options."],
];
export const REPORT_KEYWORDS: ReportKeywordInfo[] = KEYWORD_DATA.map(
  ([keyword, description]) => ({ keyword, description }),
);

export const REPORT_FUNCTIONS: ReportFunctionInfo[] = [
  {
    id: "round",
    syntax: "round(<expression>[, <digits>]) AS <alias>",
    description: "Round a calculated value to 0–10 decimal places.",
  },
  {
    id: "coalesce",
    syntax: "coalesce(<expression>, <fallback>) AS <alias>",
    description: "Use a numeric fallback when an expression is null.",
  },
  {
    id: "per_game",
    syntax: "per_game(<expression>) AS <alias>",
    description: "Divide an aggregate by games played.",
  },
  {
    id: "per_minute",
    syntax: "per_minute(<expression>) AS <alias>",
    description: "Divide an aggregate by total minutes played.",
  },
];

export const REPORT_RENDER_OPTIONS: ReportRenderOptionInfo[] = [
  { id: "x", syntax: "x = <column>", description: "Horizontal channel." },
  {
    id: "y",
    syntax: "y = <column|(<column>, …)>",
    description: "One to eight numeric series.",
  },
  {
    id: "series",
    syntax: "series = <dimension>",
    description: "Second grouping dimension for heatmaps or series.",
  },
  { id: "size", syntax: "size = <column>", description: "Scatter point size." },
  {
    id: "value",
    syntax: "value = <column>",
    description: "Heatmap cell or card value.",
  },
  { id: "title", syntax: 'title = "…"', description: "Chart title override." },
  {
    id: "subtitle",
    syntax: 'subtitle = "…"',
    description: "Optional chart subtitle.",
  },
  {
    id: "x_axis",
    syntax: 'x_axis = "…"',
    description: "Horizontal axis label.",
  },
  { id: "y_axis", syntax: 'y_axis = "…"', description: "Vertical axis label." },
  {
    id: "theme",
    syntax: "theme = lol_dark|lol_light|minimal_dark|minimal_light",
    description: "Chart surface and typography theme.",
  },
  {
    id: "palette",
    syntax: "palette = ranked|categorical|team|gold|colorblind",
    description: "Built-in series color palette.",
  },
  {
    id: "colors",
    syntax: "colors = (#rrggbb, …)",
    description:
      "One to eight custom colors, contrast-corrected for the theme.",
  },
  {
    id: "orientation",
    syntax: "orientation = horizontal|vertical",
    description: "Bar orientation.",
  },
  {
    id: "labels",
    syntax: "labels = auto|show|hide|value|percent",
    description: "Data-label behavior.",
  },
  {
    id: "legend",
    syntax: "legend = auto|none|top|right|bottom",
    description: "Legend visibility and placement.",
  },
  {
    id: "sort",
    syntax: "sort = query|asc|desc",
    description: "Visual ordering without changing query rows.",
  },
  {
    id: "smooth",
    syntax: "smooth = true|false",
    description: "Smooth line and area curves.",
  },
];

const RENDER_KIND_DATA: [string, string, string, boolean][] = [
  ["table", "Table", "Plain data table.", false],
  ["list", "List", "Bulleted text list.", false],
  ["leaderboard", "Leaderboard", "Ranked leaderboard text.", false],
  ["bar_chart", "Bar chart", "Categorical bar chart.", true],
  ["line_chart", "Line chart", "Categorical or temporal line chart.", true],
  ["stacked_bar", "Stacked bar", "Stacked multi-metric bar chart.", true],
  ["area_chart", "Area chart", "Filled categorical or temporal trend.", true],
  ["donut_chart", "Donut chart", "Part-to-whole chart for bounded rows.", true],
  [
    "scatter_chart",
    "Scatter chart",
    "Compare two outputs, optionally sized by a third.",
    true,
  ],
  ["heatmap", "Heatmap", "Two-dimensional matrix colored by a metric.", true],
  [
    "radar_chart",
    "Radar chart",
    "Compare three to eight normalized metrics.",
    true,
  ],
  [
    "kpi_card",
    "KPI card",
    "One aggregate row displayed as metric cards.",
    true,
  ],
];
export const REPORT_RENDER_KINDS: ReportRenderKindInfo[] = RENDER_KIND_DATA.map(
  ([id, label, description, isChart]) => ({
    id,
    label,
    description,
    isChart,
  }),
);

const FILTER_DATA: [string, string, string][] = [
  ["player", 'player = "<name>"', "Restrict to a player alias."],
  ["queue", "queue IN (solo, flex, …)", "Restrict to queue types."],
  ["champion_id", "champion_id = <number>", "Restrict to a champion id."],
  [
    "team_position",
    "team_position = <position>",
    "Restrict to a team position.",
  ],
  [
    "individual_position",
    "individual_position = <position>",
    "Restrict to an individual position.",
  ],
  ["lane", "lane = <lane>", "Restrict to a lane."],
  ["role", "role = <role>", "Restrict to a role."],
  ["game_mode", "game_mode = <mode>", "Restrict to a game mode."],
  ["game_type", "game_type = <type>", "Restrict to a game type."],
  [
    "game_version",
    'game_version = "<version>"',
    "Restrict to an exact version.",
  ],
  ["map_id", "map_id = <number>", "Restrict to a map id."],
  ["win", "win = true|false", "Restrict by match outcome."],
  ["surrendered", "surrendered = true|false", "Restrict by surrender state."],
  [
    "early_surrendered",
    "early_surrendered = true|false",
    "Restrict by early surrender.",
  ],
  [
    "first_blood_kill",
    "first_blood_kill = true|false",
    "Restrict by first-blood credit.",
  ],
  [
    "game_duration_seconds",
    "game_duration_seconds <operator> <number>",
    "Filter by match length.",
  ],
  ["placement", "placement <operator> <number>", "Filter by Arena placement."],
  ["kills", "kills <operator> <number>", "Filter raw participant kills."],
  ["deaths", "deaths <operator> <number>", "Filter raw participant deaths."],
  ["assists", "assists <operator> <number>", "Filter raw participant assists."],
  [
    "creep_score",
    "creep_score <operator> <number>",
    "Filter raw participant creep score.",
  ],
  ["gold_earned", "gold_earned <operator> <number>", "Filter raw gold earned."],
  ["gold_spent", "gold_spent <operator> <number>", "Filter raw gold spent."],
  [
    "damage_to_champions",
    "damage_to_champions <operator> <number>",
    "Filter raw champion damage.",
  ],
  [
    "vision_score",
    "vision_score <operator> <number>",
    "Filter raw vision score.",
  ],
  ["games", "games >= <number>", "Require at least N aggregate games."],
  [
    "competition_id",
    "competition_id = <number>",
    "Scope competition-backed sources.",
  ],
];
export const REPORT_FILTERS: ReportFilterInfo[] = FILTER_DATA.map(
  ([id, syntax, description]) => ({ id, syntax, description }),
);

export type ReportQueueValueInfo = { id: QueueType; label: string };
export function reportQueueValues(): ReportQueueValueInfo[] {
  return QueueTypeSchema.options.map((id) => ({
    id,
    label: queueTypeToDisplayString(id),
  }));
}

export function reportGroupByColumnLabel(groupBy: ReportGroupBy): string {
  return match(groupBy)
    .with("player", () => "Player")
    .with("champion", () => "Champion")
    .with("queue", () => "Queue")
    .with("group", () => "Group")
    .with("team_position", () => "Team position")
    .with("individual_position", () => "Individual position")
    .with("lane", () => "Lane")
    .with("role", () => "Role")
    .with("game_mode", () => "Game mode")
    .with("game_type", () => "Game type")
    .with("patch", () => "Patch")
    .with("map", () => "Map")
    .with("outcome", () => "Outcome")
    .with("surrender_state", () => "Surrender")
    .with("arena_placement", () => "Arena placement")
    .with("day", () => "Day")
    .with("week", () => "Week")
    .with("month", () => "Month")
    .with("all", () => "All")
    .exhaustive();
}

export function reportMetricLabel(metric: ReportMetric): string {
  return REPORT_METRICS.find((info) => info.id === metric)?.label ?? metric;
}

export function reportColumnLabel(
  column: string,
  groupBy: ReportGroupBy,
): string {
  if (column === "label") return reportGroupByColumnLabel(groupBy);
  const metric = ReportMetricSchema.safeParse(column);
  if (metric.success) return reportMetricLabel(metric.data);
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
  if (info === undefined)
    throw new Error(`Missing report source registry entry: ${source}`);
  return info;
}
