import {
  MATCH_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "#src/model/reports/lake-columns.ts";
import type { ReportDisplayKind } from "#src/model/reports/report.ts";
import {
  ScoutQlSourceSchema,
  type ScoutQlSource,
} from "#src/model/scoutql/plan.ts";

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

const DESCRIPTIONS: Record<string, string> = {
  match_id: "Riot match id (region-qualified).",
  game_id: "Riot numeric game id.",
  platform_id: "Riot platform shard (e.g. NA1).",
  game_creation_at: "When the lobby was created (UTC).",
  game_start_at: "When the game started (UTC).",
  game_end_at: "When the game ended (UTC).",
  game_duration_seconds: "Game length in seconds.",
  queue_id: "Riot numeric queue id.",
  queue: "Queue name (solo, flex, aram, …); NULL for unmapped queues.",
  game_mode: "Riot game mode (CLASSIC, ARAM, …).",
  game_type: "Riot game type (MATCHED_GAME, …).",
  game_version: "Full game version string (see the patch dimension).",
  end_of_game_result: "End-of-game result (GameComplete, or an abort state).",
  map_id: "Riot numeric map id.",
  puuid: "Riot player UUID for this participant.",
  participant_id: "Participant slot within the match (1–10).",
  team_id: "Team id (100 blue, 200 red).",
  riot_id_game_name: "Riot ID game name at match time.",
  riot_id_tagline: "Riot ID tagline at match time.",
  summoner_name: "Legacy summoner name.",
  champion_id: "Numeric champion id (compare with champion('Name')).",
  champion_name: "Champion Data-Dragon key name.",
  team_position: "Riot-assigned team position (TOP, JUNGLE, …).",
  individual_position: "Riot-computed most-likely position.",
  lane: "Reported lane.",
  role: "Reported role.",
  win: "Whether this participant won.",
  surrendered: "Whether this participant's team surrendered.",
  early_surrendered: "Whether the team surrendered early (remake window).",
  game_ended_in_surrender: "Whether the game ended in any surrender.",
  game_ended_in_early_surrender:
    "Whether the game ended in an early surrender.",
  team_early_surrendered: "Whether this participant's team early-surrendered.",
  kills: "Champion kills.",
  deaths: "Deaths.",
  assists: "Assists.",
  kda: "Riot-computed KDA ratio for this game.",
  creep_score: "Total creep score (lane + neutral minions).",
  total_minions_killed: "Lane minions killed.",
  neutral_minions_killed: "Neutral (jungle) minions killed.",
  gold_earned: "Gold earned.",
  gold_spent: "Gold spent.",
  total_damage_dealt: "Total damage dealt.",
  total_damage_dealt_to_champions: "Damage dealt to champions.",
  magic_damage_dealt_to_champions: "Magic damage dealt to champions.",
  physical_damage_dealt_to_champions: "Physical damage dealt to champions.",
  true_damage_dealt_to_champions: "True damage dealt to champions.",
  total_damage_taken: "Damage taken.",
  damage_self_mitigated: "Damage self-mitigated.",
  damage_dealt_to_objectives: "Damage dealt to objectives.",
  damage_dealt_to_turrets: "Damage dealt to turrets.",
  total_heal: "Total healing done.",
  total_heals_on_teammates: "Healing done to teammates.",
  vision_score: "Vision score.",
  wards_placed: "Wards placed.",
  wards_killed: "Wards killed.",
  vision_wards_bought_in_game: "Control wards bought.",
  detector_wards_placed: "Control wards placed.",
  all_in_pings: "All-in pings sent.",
  assist_me_pings: "Assist-me pings sent.",
  basic_pings: "Basic pings sent.",
  command_pings: "Command pings sent.",
  danger_pings: "Danger pings sent.",
  enemy_missing_pings: "Enemy-missing pings sent.",
  enemy_vision_pings: "Enemy-vision pings sent.",
  get_back_pings: "Get-back pings sent.",
  hold_pings: "Hold pings sent.",
  need_vision_pings: "Need-vision pings sent.",
  on_my_way_pings: "On-my-way pings sent.",
  push_pings: "Push pings sent.",
  vision_cleared_pings: "Vision-cleared pings sent.",
  double_kills: "Double kills.",
  triple_kills: "Triple kills.",
  quadra_kills: "Quadra kills.",
  penta_kills: "Penta kills.",
  largest_multi_kill: "Largest multikill.",
  killing_sprees: "Killing sprees.",
  first_blood_kill: "Whether this participant took first blood.",
  champ_level: "Final champion level.",
  champ_experience: "Final champion experience.",
  time_played: "Seconds played.",
  total_time_spent_dead: "Seconds spent dead.",
  longest_time_spent_living: "Longest time alive, in seconds.",
  time_ccing_others: "Seconds spent crowd-controlling others.",
  turret_kills: "Turrets destroyed.",
  inhibitor_kills: "Inhibitors destroyed.",
  baron_kills: "Barons killed.",
  dragon_kills: "Dragons killed.",
  placement: "Arena placement (NULL outside Arena).",
  subteam_placement: "Arena subteam placement (NULL outside Arena).",
  player_subteam_id: "Arena subteam id (NULL outside Arena).",
  observed_at: "When Scout observed the lobby (UTC).",
  riot_id: "Riot ID as observed in champion select.",
  selected_skin_index: "Selected skin index.",
  bot: "Whether the participant is a bot.",
};

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

function describe(name: string): string {
  const description = DESCRIPTIONS[name];
  if (description === undefined) {
    throw new Error(`Missing ScoutQL column description for "${name}".`);
  }
  return description;
}

const ALL_CONTEXTS: ScoutQlColumnContexts = {
  select: true,
  where: true,
  groupBy: true,
};

function physicalColumns(
  lake: Record<string, DuckDbColumnType>,
): ScoutQlColumnInfo[] {
  return Object.entries(lake)
    .filter(([name]) => !INTERNAL_COLUMNS.has(name))
    .map(([name, type]) => ({
      name,
      type: LAKE_TYPE[type],
      description: describe(name),
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
  if (!parsed.success) {
    return undefined;
  }
  return CATALOGS.get(parsed.data);
}

export function scoutQlSourceCatalogs(): SourceCatalog[] {
  return [...CATALOGS.values()];
}
