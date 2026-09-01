import { z } from "zod";
import type { DuckDbColumnType } from "#src/model/lake-columns.ts";

/**
 * Normalized Match-V5 timeline relations. Timeline timestamps are elapsed
 * milliseconds from game start; `observed_at` records when Scout retained the
 * canonical raw timeline and is used only for lake partitioning/audit.
 */

export const TimelineEventLakeRowSchema = z.object({
  event_id: z.string(),
  match_id: z.string(),
  month: z.string(),
  observed_at: z.string(),
  frame_index: z.number().int().nonnegative(),
  event_index: z.number().int().nonnegative(),
  frame_timestamp_ms: z.number().int().nonnegative(),
  event_timestamp_ms: z.number().int().nonnegative(),
  event_type: z.string(),
  participant_id: z.number().int().nullable(),
  killer_id: z.number().int().nullable(),
  victim_id: z.number().int().nullable(),
  creator_id: z.number().int().nullable(),
  team_id: z.number().int().nullable(),
  killer_team_id: z.number().int().nullable(),
  item_id: z.number().int().nullable(),
  after_id: z.number().int().nullable(),
  before_id: z.number().int().nullable(),
  skill_slot: z.number().int().nullable(),
  level: z.number().int().nullable(),
  bounty: z.number().int().nullable(),
  shutdown_bounty: z.number().int().nullable(),
  kill_streak_length: z.number().int().nullable(),
  gold_gain: z.number().int().nullable(),
  position_x: z.number().int().nullable(),
  position_y: z.number().int().nullable(),
  ward_type: z.string().nullable(),
  building_type: z.string().nullable(),
  lane_type: z.string().nullable(),
  tower_type: z.string().nullable(),
  monster_type: z.string().nullable(),
  monster_sub_type: z.string().nullable(),
  level_up_type: z.string().nullable(),
  winning_team_id: z.number().int().nullable(),
  real_timestamp_ms: z.number().int().nullable(),
});

export type TimelineEventLakeRow = z.infer<typeof TimelineEventLakeRowSchema>;

export const TimelineEventParticipantRoleSchema = z.enum([
  "subject",
  "killer",
  "victim",
  "assist",
  "creator",
]);

export const TimelineEventParticipantLakeRowSchema = z.object({
  event_id: z.string(),
  match_id: z.string(),
  month: z.string(),
  observed_at: z.string(),
  participant_id: z.number().int(),
  puuid: z.string().nullable(),
  role: TimelineEventParticipantRoleSchema,
  role_index: z.number().int().nonnegative(),
});

export type TimelineEventParticipantLakeRow = z.infer<
  typeof TimelineEventParticipantLakeRowSchema
>;

export const TimelineParticipantFrameLakeRowSchema = z.object({
  match_id: z.string(),
  month: z.string(),
  observed_at: z.string(),
  frame_index: z.number().int().nonnegative(),
  frame_timestamp_ms: z.number().int().nonnegative(),
  participant_id: z.number().int(),
  puuid: z.string().nullable(),
  position_x: z.number().int(),
  position_y: z.number().int(),
  current_gold: z.number().int(),
  total_gold: z.number().int(),
  gold_per_second: z.number().int(),
  minions_killed: z.number().int(),
  jungle_minions_killed: z.number().int(),
  level: z.number().int(),
  xp: z.number().int(),
  time_enemy_spent_controlled: z.number(),
  ability_haste: z.number().nullable(),
  ability_power: z.number().nullable(),
  armor: z.number().nullable(),
  attack_damage: z.number().nullable(),
  attack_speed: z.number().nullable(),
  health: z.number().nullable(),
  health_max: z.number().nullable(),
  magic_resist: z.number().nullable(),
  movement_speed: z.number().nullable(),
  power: z.number().nullable(),
  power_max: z.number().nullable(),
  total_damage_done: z.number().nullable(),
  total_damage_done_to_champions: z.number().nullable(),
  total_damage_taken: z.number().nullable(),
});

export type TimelineParticipantFrameLakeRow = z.infer<
  typeof TimelineParticipantFrameLakeRowSchema
>;

export const TimelineCoverageStateSchema = z.enum(["complete"]);

export const TimelineCoverageLakeRowSchema = z.object({
  match_id: z.string(),
  month: z.string(),
  observed_at: z.string(),
  coverage_state: TimelineCoverageStateSchema,
  data_version: z.string(),
  frame_interval_ms: z.number().int().positive(),
  frame_count: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
  participant_count: z.number().int().nonnegative(),
  first_frame_timestamp_ms: z.number().int().nonnegative().nullable(),
  last_frame_timestamp_ms: z.number().int().nonnegative().nullable(),
});

export type TimelineCoverageLakeRow = z.infer<
  typeof TimelineCoverageLakeRowSchema
>;

export const TIMELINE_EVENT_LAKE_COLUMNS: Record<
  keyof TimelineEventLakeRow,
  DuckDbColumnType
> = {
  event_id: "VARCHAR",
  match_id: "VARCHAR",
  month: "VARCHAR",
  observed_at: "TIMESTAMP",
  frame_index: "INTEGER",
  event_index: "INTEGER",
  frame_timestamp_ms: "BIGINT",
  event_timestamp_ms: "BIGINT",
  event_type: "VARCHAR",
  participant_id: "INTEGER",
  killer_id: "INTEGER",
  victim_id: "INTEGER",
  creator_id: "INTEGER",
  team_id: "INTEGER",
  killer_team_id: "INTEGER",
  item_id: "INTEGER",
  after_id: "INTEGER",
  before_id: "INTEGER",
  skill_slot: "INTEGER",
  level: "INTEGER",
  bounty: "INTEGER",
  shutdown_bounty: "INTEGER",
  kill_streak_length: "INTEGER",
  gold_gain: "INTEGER",
  position_x: "INTEGER",
  position_y: "INTEGER",
  ward_type: "VARCHAR",
  building_type: "VARCHAR",
  lane_type: "VARCHAR",
  tower_type: "VARCHAR",
  monster_type: "VARCHAR",
  monster_sub_type: "VARCHAR",
  level_up_type: "VARCHAR",
  winning_team_id: "INTEGER",
  real_timestamp_ms: "BIGINT",
};

export const TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS: Record<
  keyof TimelineEventParticipantLakeRow,
  DuckDbColumnType
> = {
  event_id: "VARCHAR",
  match_id: "VARCHAR",
  month: "VARCHAR",
  observed_at: "TIMESTAMP",
  participant_id: "INTEGER",
  puuid: "VARCHAR",
  role: "VARCHAR",
  role_index: "INTEGER",
};

export const TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS: Record<
  keyof TimelineParticipantFrameLakeRow,
  DuckDbColumnType
> = {
  match_id: "VARCHAR",
  month: "VARCHAR",
  observed_at: "TIMESTAMP",
  frame_index: "INTEGER",
  frame_timestamp_ms: "BIGINT",
  participant_id: "INTEGER",
  puuid: "VARCHAR",
  position_x: "INTEGER",
  position_y: "INTEGER",
  current_gold: "INTEGER",
  total_gold: "INTEGER",
  gold_per_second: "INTEGER",
  minions_killed: "INTEGER",
  jungle_minions_killed: "INTEGER",
  level: "INTEGER",
  xp: "INTEGER",
  time_enemy_spent_controlled: "DOUBLE",
  ability_haste: "DOUBLE",
  ability_power: "DOUBLE",
  armor: "DOUBLE",
  attack_damage: "DOUBLE",
  attack_speed: "DOUBLE",
  health: "DOUBLE",
  health_max: "DOUBLE",
  magic_resist: "DOUBLE",
  movement_speed: "DOUBLE",
  power: "DOUBLE",
  power_max: "DOUBLE",
  total_damage_done: "DOUBLE",
  total_damage_done_to_champions: "DOUBLE",
  total_damage_taken: "DOUBLE",
};

export const TIMELINE_COVERAGE_LAKE_COLUMNS: Record<
  keyof TimelineCoverageLakeRow,
  DuckDbColumnType
> = {
  match_id: "VARCHAR",
  month: "VARCHAR",
  observed_at: "TIMESTAMP",
  coverage_state: "VARCHAR",
  data_version: "VARCHAR",
  frame_interval_ms: "BIGINT",
  frame_count: "INTEGER",
  event_count: "INTEGER",
  participant_count: "INTEGER",
  first_frame_timestamp_ms: "BIGINT",
  last_frame_timestamp_ms: "BIGINT",
};
