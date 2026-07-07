import { z } from "zod";

/**
 * Report-lake table schemas — the single source of truth for lake column
 * names and types. Both the compactor (writes) and the DuckDB query engine
 * (reads) import from here so the two sides cannot drift.
 *
 * Rows are serialized as newline-delimited JSON (staging + compaction temp
 * files) and converted to Parquet by DuckDB with an explicit column-type map
 * (never schema inference — a sparse first line must not narrow types).
 *
 * Timestamps are naive-UTC strings ("YYYY-MM-DD HH:MM:SS.mmm") that DuckDB
 * reads as TIMESTAMP; query-side comparisons use epoch_ms() against bound
 * epoch-millis, sidestepping session-timezone semantics entirely.
 */

export function lakeTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}

/** Partition key: month of the row's primary timestamp, e.g. "2026-07". */
export function lakeMonth(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 7);
}

export const MatchLakeRowSchema = z.object({
  // Match keys
  match_id: z.string(),
  game_id: z.string(),
  platform_id: z.string(),
  month: z.string(),
  // Match times
  game_creation_at: z.string(),
  game_start_at: z.string(),
  game_end_at: z.string(),
  game_duration_seconds: z.number(),
  // Match context
  queue_id: z.number(),
  queue: z.string().nullable(),
  game_mode: z.string(),
  game_type: z.string(),
  game_version: z.string(),
  map_id: z.number(),
  // Participant identity (global — attribution happens at query time)
  puuid: z.string(),
  participant_id: z.number(),
  team_id: z.number(),
  riot_id_game_name: z.string().nullable(),
  riot_id_tagline: z.string(),
  summoner_name: z.string(),
  // Champion / position
  champion_id: z.number(),
  champion_name: z.string(),
  team_position: z.string(),
  individual_position: z.string(),
  lane: z.string().nullable(),
  role: z.string().nullable(),
  // Outcome
  win: z.boolean(),
  surrendered: z.boolean(),
  early_surrendered: z.boolean(),
  game_ended_in_surrender: z.boolean(),
  game_ended_in_early_surrender: z.boolean(),
  team_early_surrendered: z.boolean(),
  // Core stats
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
  kda: z.number(),
  creep_score: z.number(),
  total_minions_killed: z.number(),
  neutral_minions_killed: z.number(),
  // Economy
  gold_earned: z.number(),
  gold_spent: z.number(),
  // Damage
  total_damage_dealt: z.number(),
  total_damage_dealt_to_champions: z.number(),
  total_damage_taken: z.number(),
  damage_self_mitigated: z.number(),
  damage_dealt_to_objectives: z.number(),
  damage_dealt_to_turrets: z.number(),
  // Healing
  total_heal: z.number(),
  total_heals_on_teammates: z.number(),
  // Vision
  vision_score: z.number(),
  wards_placed: z.number(),
  wards_killed: z.number(),
  vision_wards_bought_in_game: z.number(),
  detector_wards_placed: z.number(),
  // Multikills / sprees
  double_kills: z.number(),
  triple_kills: z.number(),
  quadra_kills: z.number(),
  penta_kills: z.number(),
  largest_multi_kill: z.number(),
  killing_sprees: z.number(),
  first_blood_kill: z.boolean(),
  // Progression
  champ_level: z.number(),
  champ_experience: z.number(),
  // Time
  time_played: z.number(),
  total_time_spent_dead: z.number(),
  longest_time_spent_living: z.number(),
  time_ccing_others: z.number(),
  // Objectives
  turret_kills: z.number(),
  inhibitor_kills: z.number(),
  baron_kills: z.number(),
  dragon_kills: z.number(),
  // Arena
  placement: z.number().nullable(),
  subteam_placement: z.number().nullable(),
  player_subteam_id: z.number().nullable(),
});

export type MatchLakeRow = z.infer<typeof MatchLakeRowSchema>;

export const PrematchLakeRowSchema = z.object({
  dedupe_key: z.string(),
  game_id: z.string(),
  platform_id: z.string(),
  month: z.string(),
  observed_at: z.string(),
  game_start_at: z.string().nullable(),
  queue_id: z.number(),
  queue: z.string().nullable(),
  game_mode: z.string(),
  game_type: z.string(),
  map_id: z.number(),
  puuid: z.string(),
  team_id: z.number(),
  player_subteam_id: z.number().nullable(),
  champion_id: z.number(),
  riot_id: z.string(),
  summoner_name: z.string().nullable(),
  selected_skin_index: z.number(),
  bot: z.boolean(),
});

export type PrematchLakeRow = z.infer<typeof PrematchLakeRowSchema>;

export const AccountLakeRowSchema = z.object({
  server_id: z.string(),
  puuid: z.string(),
  account_id: z.number(),
  account_alias: z.string(),
  region: z.string(),
  player_id: z.number(),
  player_alias: z.string(),
  discord_id: z.string().nullable(),
});

export type AccountLakeRow = z.infer<typeof AccountLakeRowSchema>;

type DuckDbColumnType =
  | "VARCHAR"
  | "INTEGER"
  | "BIGINT"
  | "DOUBLE"
  | "BOOLEAN"
  | "TIMESTAMP";

export const MATCH_LAKE_COLUMNS: Record<keyof MatchLakeRow, DuckDbColumnType> =
  {
    match_id: "VARCHAR",
    game_id: "VARCHAR",
    platform_id: "VARCHAR",
    month: "VARCHAR",
    game_creation_at: "TIMESTAMP",
    game_start_at: "TIMESTAMP",
    game_end_at: "TIMESTAMP",
    game_duration_seconds: "INTEGER",
    queue_id: "INTEGER",
    queue: "VARCHAR",
    game_mode: "VARCHAR",
    game_type: "VARCHAR",
    game_version: "VARCHAR",
    map_id: "INTEGER",
    puuid: "VARCHAR",
    participant_id: "INTEGER",
    team_id: "INTEGER",
    riot_id_game_name: "VARCHAR",
    riot_id_tagline: "VARCHAR",
    summoner_name: "VARCHAR",
    champion_id: "INTEGER",
    champion_name: "VARCHAR",
    team_position: "VARCHAR",
    individual_position: "VARCHAR",
    lane: "VARCHAR",
    role: "VARCHAR",
    win: "BOOLEAN",
    surrendered: "BOOLEAN",
    early_surrendered: "BOOLEAN",
    game_ended_in_surrender: "BOOLEAN",
    game_ended_in_early_surrender: "BOOLEAN",
    team_early_surrendered: "BOOLEAN",
    kills: "INTEGER",
    deaths: "INTEGER",
    assists: "INTEGER",
    kda: "DOUBLE",
    creep_score: "INTEGER",
    total_minions_killed: "INTEGER",
    neutral_minions_killed: "INTEGER",
    gold_earned: "INTEGER",
    gold_spent: "INTEGER",
    total_damage_dealt: "INTEGER",
    total_damage_dealt_to_champions: "INTEGER",
    total_damage_taken: "INTEGER",
    damage_self_mitigated: "INTEGER",
    damage_dealt_to_objectives: "INTEGER",
    damage_dealt_to_turrets: "INTEGER",
    total_heal: "INTEGER",
    total_heals_on_teammates: "INTEGER",
    vision_score: "INTEGER",
    wards_placed: "INTEGER",
    wards_killed: "INTEGER",
    vision_wards_bought_in_game: "INTEGER",
    detector_wards_placed: "INTEGER",
    double_kills: "INTEGER",
    triple_kills: "INTEGER",
    quadra_kills: "INTEGER",
    penta_kills: "INTEGER",
    largest_multi_kill: "INTEGER",
    killing_sprees: "INTEGER",
    first_blood_kill: "BOOLEAN",
    champ_level: "INTEGER",
    champ_experience: "INTEGER",
    time_played: "INTEGER",
    total_time_spent_dead: "INTEGER",
    longest_time_spent_living: "INTEGER",
    time_ccing_others: "INTEGER",
    turret_kills: "INTEGER",
    inhibitor_kills: "INTEGER",
    baron_kills: "INTEGER",
    dragon_kills: "INTEGER",
    placement: "INTEGER",
    subteam_placement: "INTEGER",
    player_subteam_id: "INTEGER",
  };

export const PREMATCH_LAKE_COLUMNS: Record<
  keyof PrematchLakeRow,
  DuckDbColumnType
> = {
  dedupe_key: "VARCHAR",
  game_id: "VARCHAR",
  platform_id: "VARCHAR",
  month: "VARCHAR",
  observed_at: "TIMESTAMP",
  game_start_at: "TIMESTAMP",
  queue_id: "INTEGER",
  queue: "VARCHAR",
  game_mode: "VARCHAR",
  game_type: "VARCHAR",
  map_id: "INTEGER",
  puuid: "VARCHAR",
  team_id: "INTEGER",
  player_subteam_id: "INTEGER",
  champion_id: "INTEGER",
  riot_id: "VARCHAR",
  summoner_name: "VARCHAR",
  selected_skin_index: "INTEGER",
  bot: "BOOLEAN",
};

export const ACCOUNT_LAKE_COLUMNS: Record<
  keyof AccountLakeRow,
  DuckDbColumnType
> = {
  server_id: "VARCHAR",
  puuid: "VARCHAR",
  account_id: "INTEGER",
  account_alias: "VARCHAR",
  region: "VARCHAR",
  player_id: "INTEGER",
  player_alias: "VARCHAR",
  discord_id: "VARCHAR",
};

/**
 * Render a column-type map as the `columns={...}` argument for read_json.
 * Column names come from our own literals above (never user input), so
 * embedding them in SQL text is safe.
 */
export function duckDbColumnsSpec(
  columns: Record<string, DuckDbColumnType>,
): string {
  const entries = Object.entries(columns)
    .map(([name, type]) => `${name}: '${type}'`)
    .join(", ");
  return `{${entries}}`;
}
