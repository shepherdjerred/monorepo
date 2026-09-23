import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "#src/model/reports/lake-columns.ts";
import type { ReportDisplayKind } from "#src/model/reports/report.ts";
import {
  MATCH_TEAM_DESCRIPTIONS,
  describe,
} from "#src/model/scoutql/catalog/catalog-descriptions.ts";
import {
  ScoutQlSourceSchema,
  type ScoutQlSource,
} from "#src/model/scoutql/parse/plan.ts";

// ── ScoutQL source catalogs ──────────────────────────────────────────────────
// The closed vocabulary of every source: which columns exist, their DuckDB
// types, where each may appear (SELECT aggregate args / WHERE / GROUP BY), and
// how a raw column displays. Physical columns come verbatim from the lake
// schema maps in lake-columns.ts (a drift test pins that); virtual dimension
// columns mirror EXACTLY what the engine's grouping/expression compiler can
// compute (backend reports/duckdb/expr-sql.ts + group-sql.ts).

export type ScoutQlColumnType =
  "varchar" | "integer" | "bigint" | "double" | "boolean" | "timestamp";

export type ScoutQlColumnContexts = {
  /** Usable inside SELECT expressions (aggregate arguments, echoes). */
  select: boolean;
  /** Usable in WHERE / FILTER predicates. */
  where: boolean;
  /** Usable as a GROUP BY dimension. */
  groupBy: boolean;
};

export type ScoutQlColumnInfo = {
  name: string;
  type: ScoutQlColumnType;
  description: string;
  /** Display kind of the RAW column (aggregates over it may inherit it). */
  displayKind: ReportDisplayKind;
  /** Computed by the engine (dimension), not a physical lake column. */
  virtual: boolean;
  contexts: ScoutQlColumnContexts;
};

export type SourceCatalog = {
  id: ScoutQlSource;
  description: string;
  /** Ordered: lake-schema order, then virtual dimensions. */
  columns: Map<string, ScoutQlColumnInfo>;
  /** The timestamp column time windows recognize; null for rank snapshots. */
  timeColumn: string | null;
  requiresCompetitionId: boolean;
  /** Whether `player('…')` references are executable on this source. */
  playerRefAllowed: boolean;
  /** Whether `GROUP BY group(n|all)` applies (player_groups only). */
  groupCall: boolean;
};

const LAKE_TYPE: Record<DuckDbColumnType, ScoutQlColumnType> = {
  VARCHAR: "varchar",
  INTEGER: "integer",
  BIGINT: "bigint",
  DOUBLE: "double",
  BOOLEAN: "boolean",
  TIMESTAMP: "timestamp",
};

/** Raw columns that hold seconds and display as durations. */
const DURATION_COLUMNS = new Set([
  "game_duration_seconds",
  "time_played",
  "total_time_spent_dead",
  "longest_time_spent_living",
  "time_ccing_others",
]);

/** Internal plumbing excluded from every catalog (partitioning / dedupe). */
const INTERNAL_COLUMNS = new Set(["month", "dedupe_key"]);

function rawDisplayKind(
  name: string,
  type: ScoutQlColumnType,
): ReportDisplayKind {
  if (DURATION_COLUMNS.has(name)) {
    return "duration";
  }
  if (name === "kda") {
    return "ratio";
  }
  switch (type) {
    case "timestamp":
      return "timestamp";
    case "varchar":
    case "boolean":
      return "text";
    case "double":
      return "decimal";
    case "integer":
    case "bigint":
      return "count";
  }
}

const ALL_CONTEXTS: ScoutQlColumnContexts = {
  select: true,
  where: true,
  groupBy: true,
};

function physicalColumns(
  lake: Record<string, DuckDbColumnType>,
  overrides?: Record<string, string>,
): ScoutQlColumnInfo[] {
  return Object.entries(lake)
    .filter(([name]) => !INTERNAL_COLUMNS.has(name))
    .map(([name, type]) => ({
      name,
      type: LAKE_TYPE[type],
      description: describe(name, overrides),
      displayKind: rawDisplayKind(name, LAKE_TYPE[type]),
      virtual: false,
      contexts: ALL_CONTEXTS,
    }));
}

function virtualColumn(
  name: string,
  type: ScoutQlColumnType,
  description: string,
  contexts: ScoutQlColumnContexts = ALL_CONTEXTS,
): ScoutQlColumnInfo {
  return {
    name,
    type,
    description,
    displayKind: "text",
    virtual: true,
    contexts,
  };
}

// Virtual dimensions mirror backend expr-sql.ts MATCH_VIRTUAL_COLUMNS /
// PREMATCH_VIRTUAL_COLUMNS exactly — expose only what those arms can compute.
const MATCH_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "player",
    "varchar",
    "Tracked player (alias in guild scope, Riot ID globally). Filter with player('…').",
  ),
  virtualColumn(
    "champion",
    "varchar",
    "Champion display dimension (champion_name).",
  ),
  virtualColumn(
    "patch",
    "varchar",
    "Game patch (major.minor of game_version).",
  ),
  virtualColumn("outcome", "varchar", "'Win' or 'Loss' (from win)."),
  virtualColumn(
    "surrender_state",
    "varchar",
    "'Early surrender', 'Surrender', or 'Played out'.",
  ),
  virtualColumn(
    "arena_placement",
    "varchar",
    "Arena placement label ('Not Arena' outside Arena).",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id)."),
];

const PREMATCH_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn(
    "player",
    "varchar",
    "Tracked player (alias in guild scope, Riot ID globally). Filter with player('…').",
  ),
  virtualColumn(
    "champion",
    "varchar",
    "Champion dimension (numeric id shown — prematch rows carry no name).",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id)."),
];

/**
 * Team rows carry no match facts of their own, so the engine looks them up.
 *
 * `match_teams` holds only `match_id`, `team_id` and the objective columns —
 * no timestamp, no queue, no version. Every one of those is needed to ask an
 * objective question honestly: "first dragon wins more" is meaningless over a
 * corpus that mixes Summoner's Rift with ARAM, where no dragon exists and both
 * teams land in the same bucket. So the compiler joins one row per match from
 * the participant table and projects these four; the join is keyed on
 * `match_id` and collapsed to one row per match, so it cannot fan a team row
 * out. It is a lookup of the parent row, not a join between two fact sources —
 * ScoutQL plans remain single-source.
 */
const MATCH_TEAM_VIRTUALS: ScoutQlColumnInfo[] = [
  virtualColumn("outcome", "varchar", "'Win' or 'Loss' (from win)."),
  virtualColumn(
    "side",
    "varchar",
    "'Blue' or 'Red' (from team_id); the raw id for modes that use others.",
  ),
  virtualColumn(
    "game_creation_at",
    "timestamp",
    "When the lobby was created (UTC), from the match this team played.",
  ),
  virtualColumn(
    "queue",
    "varchar",
    "Queue name of the match (solo, flex, aram, …); NULL for unmapped queues.",
  ),
  virtualColumn(
    "patch",
    "varchar",
    "Game patch (major.minor) of the match this team played.",
  ),
  virtualColumn("map", "integer", "Map dimension (map_id) of the match."),
];

const COMPETITION_ID_COLUMN = virtualColumn(
  "competition_id",
  "integer",
  "Competition to report on — required as a top-level `competition_id = <n>` condition.",
  { select: false, where: true, groupBy: false },
);

function toMap(columns: ScoutQlColumnInfo[]): Map<string, ScoutQlColumnInfo> {
  return new Map(columns.map((column) => [column.name, column]));
}

// player_groups: WHERE takes GAME-LEVEL columns (identical across a group's
// members); SELECT aggregates over MEMBER-SUMMED counters. Timestamps beyond
// the WHERE-able time column are filterable but not aggregable, and per-player
// identity/champion/position columns are not exposed at all — "which member?"
// has no answer for a group row.
const GROUP_GAME_LEVEL = new Set([
  "win",
  "surrendered",
  "early_surrendered",
  "game_ended_in_surrender",
  "game_ended_in_early_surrender",
  "team_early_surrendered",
  "game_duration_seconds",
  "queue_id",
  "queue",
  "game_mode",
  "game_type",
  "game_version",
  "end_of_game_result",
  "map_id",
]);
const GROUP_TIME_FILTER_ONLY = new Set([
  "game_creation_at",
  "game_start_at",
  "game_end_at",
]);
const GROUP_EXCLUDED = new Set([
  "match_id",
  "game_id",
  "platform_id",
  "puuid",
  "participant_id",
  "team_id",
  "riot_id_game_name",
  "riot_id_tagline",
  "summoner_name",
  "champion_id",
  "champion_name",
  "team_position",
  "individual_position",
  "lane",
  "role",
  "kda",
  "first_blood_kill",
  "placement",
  "subteam_placement",
  "player_subteam_id",
]);

function playerGroupsColumns(): ScoutQlColumnInfo[] {
  return physicalColumns(MATCH_LAKE_COLUMNS)
    .filter((column) => !GROUP_EXCLUDED.has(column.name))
    .map((column) => {
      if (GROUP_TIME_FILTER_ONLY.has(column.name)) {
        return {
          ...column,
          contexts: { select: false, where: true, groupBy: false },
        };
      }
      if (GROUP_GAME_LEVEL.has(column.name)) {
        return {
          ...column,
          contexts: { select: true, where: true, groupBy: false },
        };
      }
      // Member-summed counter: SELECT-only.
      return {
        ...column,
        contexts: { select: true, where: false, groupBy: false },
      };
    });
}

function rankColumns(): ScoutQlColumnInfo[] {
  return [
    virtualColumn(
      "player",
      "varchar",
      "Tracked player this snapshot row belongs to.",
    ),
    {
      name: "score",
      type: "double",
      description: "Rank score (higher is better).",
      displayKind: "decimal",
      virtual: false,
      contexts: { select: true, where: true, groupBy: false },
    },
    {
      name: "rank",
      type: "integer",
      description: "Position within the snapshot (1 = best).",
      displayKind: "count",
      virtual: false,
      contexts: { select: true, where: true, groupBy: false },
    },
  ];
}

const CATALOG_LIST: SourceCatalog[] = [
  {
    id: "match_participants",
    description: "One row per participant per finished match.",
    columns: toMap([...physicalColumns(MATCH_LAKE_COLUMNS), ...MATCH_VIRTUALS]),
    timeColumn: "game_creation_at",
    requiresCompetitionId: false,
    playerRefAllowed: true,
    groupCall: false,
  },
  {
    id: "prematch_participants",
    description:
      "Champion-select / lobby observations, one row per participant.",
    columns: toMap([
      ...physicalColumns(PREMATCH_LAKE_COLUMNS),
      ...PREMATCH_VIRTUALS,
    ]),
    timeColumn: "observed_at",
    requiresCompetitionId: false,
    playerRefAllowed: true,
    groupCall: false,
  },
  {
    id: "match_teams",
    description:
      "Team-level objective counts and first-objective flags, two rows per match; no player identity, so global scope only.",
    columns: toMap([
      ...physicalColumns(MATCH_TEAM_LAKE_COLUMNS, MATCH_TEAM_DESCRIPTIONS),
      ...MATCH_TEAM_VIRTUALS,
    ]),
    timeColumn: "game_creation_at",
    requiresCompetitionId: false,
    // No puuid exists on a team row, so there is nothing for player('…') to
    // resolve against and no accounts join to scope a server by.
    playerRefAllowed: false,
    groupCall: false,
  },
  {
    id: "player_groups",
    description:
      "Teammate groups of tracked players queueing together; GROUP BY group(n|all).",
    columns: toMap(playerGroupsColumns()),
    timeColumn: "game_creation_at",
    requiresCompetitionId: false,
    playerRefAllowed: false,
    groupCall: true,
  },
  {
    id: "rank_current",
    description: "Current rank snapshot, one row per tracked player.",
    columns: toMap(rankColumns()),
    timeColumn: null,
    requiresCompetitionId: false,
    playerRefAllowed: false,
    groupCall: false,
  },
  {
    id: "competition_match_participants",
    description:
      "Match participants scoped to one competition's players and range.",
    columns: toMap([
      ...physicalColumns(MATCH_LAKE_COLUMNS),
      ...MATCH_VIRTUALS,
      COMPETITION_ID_COLUMN,
    ]),
    timeColumn: "game_creation_at",
    requiresCompetitionId: true,
    playerRefAllowed: true,
    groupCall: false,
  },
  {
    id: "competition_rank",
    description: "Current standings snapshot for one competition.",
    columns: toMap([...rankColumns(), COMPETITION_ID_COLUMN]),
    timeColumn: null,
    requiresCompetitionId: true,
    playerRefAllowed: false,
    groupCall: false,
  },
];

const CATALOGS = new Map<ScoutQlSource, SourceCatalog>(
  CATALOG_LIST.map((catalog) => [catalog.id, catalog]),
);

export function scoutQlSourceCatalog(name: string): SourceCatalog | undefined {
  const parsed = ScoutQlSourceSchema.safeParse(name.toLowerCase());
  return parsed.success ? CATALOGS.get(parsed.data) : undefined;
}

export function scoutQlSourceCatalogs(): SourceCatalog[] {
  return [...CATALOGS.values()];
}
