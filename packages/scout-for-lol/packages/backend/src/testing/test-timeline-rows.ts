import type {
  TimelineEventLakeRow,
  TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";

/**
 * Timeline rows for test lakes, with every field a test does not care about
 * zeroed or absent, so a fixture states only what its assertions depend on.
 */

/** A timeline frame with every stat zeroed or absent except those given. */
export function testFrameRow(input: {
  readonly matchId: string;
  readonly gameCreationAt: Date;
  readonly puuid: string;
  readonly participantId: number;
  readonly minute: number;
  readonly totalGold: number;
  readonly minions: number;
  readonly jungle: number;
}): TimelineParticipantFrameLakeRow {
  return {
    match_id: input.matchId,
    month: lakeMonth(input.gameCreationAt.getTime()),
    observed_at: lakeTimestamp(input.gameCreationAt.getTime()),
    frame_index: input.minute,
    // Real frames land a few milliseconds past the minute.
    frame_timestamp_ms: input.minute * 60_000 + 23,
    participant_id: input.participantId,
    puuid: input.puuid,
    position_x: 0,
    position_y: 0,
    current_gold: 0,
    total_gold: input.totalGold,
    gold_per_second: 0,
    minions_killed: input.minions,
    jungle_minions_killed: input.jungle,
    level: 1,
    xp: 0,
    time_enemy_spent_controlled: 0,
    ability_haste: null,
    ability_power: null,
    armor: null,
    attack_damage: null,
    attack_speed: null,
    health: null,
    health_max: null,
    magic_resist: null,
    movement_speed: null,
    power: null,
    power_max: null,
    total_damage_done: null,
    total_damage_done_to_champions: null,
    total_damage_taken: null,
  };
}

/** A timeline event with every optional field absent except those given. */
export function testEventRow(
  gameCreationAt: Date,
  row: Partial<TimelineEventLakeRow> & {
    readonly event_id: string;
    readonly match_id: string;
    readonly event_type: string;
    readonly event_timestamp_ms: number;
  },
): TimelineEventLakeRow {
  const minute = Math.floor(row.event_timestamp_ms / 60_000);
  return {
    month: lakeMonth(gameCreationAt.getTime()),
    observed_at: lakeTimestamp(gameCreationAt.getTime()),
    frame_index: minute,
    event_index: 0,
    frame_timestamp_ms: minute * 60_000,
    participant_id: null,
    killer_id: null,
    victim_id: null,
    creator_id: null,
    team_id: null,
    killer_team_id: null,
    item_id: null,
    after_id: null,
    before_id: null,
    skill_slot: null,
    level: null,
    bounty: null,
    shutdown_bounty: null,
    kill_streak_length: null,
    gold_gain: null,
    position_x: null,
    position_y: null,
    ward_type: null,
    building_type: null,
    lane_type: null,
    tower_type: null,
    monster_type: null,
    monster_sub_type: null,
    level_up_type: null,
    winning_team_id: null,
    real_timestamp_ms: null,
    ...row,
  };
}
