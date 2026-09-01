import type {
  RawTimeline,
  RawTimelineEvent,
  RawTimelineParticipantFrame,
  TimelineCoverageLakeRow,
  TimelineEventLakeRow,
  TimelineEventParticipantLakeRow,
  TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";

export type FlattenedTimeline = {
  events: TimelineEventLakeRow[];
  eventParticipants: TimelineEventParticipantLakeRow[];
  participantFrames: TimelineParticipantFrameLakeRow[];
  coverage: TimelineCoverageLakeRow[];
};

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function eventId(matchId: string, frameIndex: number, index: number): string {
  return `${matchId}:${frameIndex.toString()}:${index.toString()}`;
}

function flattenEvent(options: {
  event: RawTimelineEvent;
  id: string;
  matchId: string;
  month: string;
  observedAt: string;
  frameIndex: number;
  eventIndex: number;
  frameTimestampMs: number;
}): TimelineEventLakeRow {
  const event = options.event;
  return {
    event_id: options.id,
    match_id: options.matchId,
    month: options.month,
    observed_at: options.observedAt,
    frame_index: options.frameIndex,
    event_index: options.eventIndex,
    frame_timestamp_ms: options.frameTimestampMs,
    event_timestamp_ms: event.timestamp,
    event_type: event.type,
    participant_id: nullable(event.participantId),
    killer_id: nullable(event.killerId),
    victim_id: nullable(event.victimId),
    creator_id: nullable(event.creatorId),
    team_id: nullable(event.teamId),
    killer_team_id: nullable(event.killerTeamId),
    item_id: nullable(event.itemId),
    after_id: nullable(event.afterId),
    before_id: nullable(event.beforeId),
    skill_slot: nullable(event.skillSlot),
    level: nullable(event.level),
    bounty: nullable(event.bounty),
    shutdown_bounty: nullable(event.shutdownBounty),
    kill_streak_length: nullable(event.killStreakLength),
    gold_gain: nullable(event.goldGain),
    position_x: nullable(event.position?.x),
    position_y: nullable(event.position?.y),
    ward_type: nullable(event.wardType),
    building_type: nullable(event.buildingType),
    lane_type: nullable(event.laneType),
    tower_type: nullable(event.towerType),
    monster_type: nullable(event.monsterType),
    monster_sub_type: nullable(event.monsterSubType),
    level_up_type: nullable(event.levelUpType),
    winning_team_id: nullable(event.winningTeam),
    real_timestamp_ms: nullable(event.realTimestamp),
  };
}

function eventParticipantRows(options: {
  event: RawTimelineEvent;
  id: string;
  matchId: string;
  month: string;
  observedAt: string;
  puuidByParticipant: Map<number, string>;
}): TimelineEventParticipantLakeRow[] {
  const common = {
    event_id: options.id,
    match_id: options.matchId,
    month: options.month,
    observed_at: options.observedAt,
  };
  const rows: TimelineEventParticipantLakeRow[] = [];
  const add = (
    participantId: number | undefined,
    role: TimelineEventParticipantLakeRow["role"],
    roleIndex: number,
  ): void => {
    if (participantId === undefined) return;
    rows.push({
      ...common,
      participant_id: participantId,
      puuid: options.puuidByParticipant.get(participantId) ?? null,
      role,
      role_index: roleIndex,
    });
  };
  add(options.event.participantId, "subject", 0);
  add(options.event.killerId, "killer", 0);
  add(options.event.victimId, "victim", 0);
  add(options.event.creatorId, "creator", 0);
  for (const [index, participantId] of (
    options.event.assistingParticipantIds ?? []
  ).entries()) {
    add(participantId, "assist", index);
  }
  return rows;
}

function championFrameStats(
  frame: RawTimelineParticipantFrame,
): Pick<
  TimelineParticipantFrameLakeRow,
  | "ability_haste"
  | "ability_power"
  | "armor"
  | "attack_damage"
  | "attack_speed"
  | "health"
  | "health_max"
  | "magic_resist"
  | "movement_speed"
  | "power"
  | "power_max"
> {
  const stats = frame.championStats;
  return {
    ability_haste: nullable(stats?.abilityHaste),
    ability_power: nullable(stats?.abilityPower),
    armor: nullable(stats?.armor),
    attack_damage: nullable(stats?.attackDamage),
    attack_speed: nullable(stats?.attackSpeed),
    health: nullable(stats?.health),
    health_max: nullable(stats?.healthMax),
    magic_resist: nullable(stats?.magicResist),
    movement_speed: nullable(stats?.movementSpeed),
    power: nullable(stats?.power),
    power_max: nullable(stats?.powerMax),
  };
}

function damageFrameStats(
  frame: RawTimelineParticipantFrame,
): Pick<
  TimelineParticipantFrameLakeRow,
  "total_damage_done" | "total_damage_done_to_champions" | "total_damage_taken"
> {
  const stats = frame.damageStats;
  return {
    total_damage_done: nullable(stats?.totalDamageDone),
    total_damage_done_to_champions: nullable(stats?.totalDamageDoneToChampions),
    total_damage_taken: nullable(stats?.totalDamageTaken),
  };
}

function participantFrameRow(options: {
  frame: RawTimelineParticipantFrame;
  frameIndex: number;
  frameTimestampMs: number;
  matchId: string;
  month: string;
  observedAt: string;
  puuidByParticipant: ReadonlyMap<number, string>;
}): TimelineParticipantFrameLakeRow {
  const frame = options.frame;
  return {
    match_id: options.matchId,
    month: options.month,
    observed_at: options.observedAt,
    frame_index: options.frameIndex,
    frame_timestamp_ms: options.frameTimestampMs,
    participant_id: frame.participantId,
    puuid: options.puuidByParticipant.get(frame.participantId) ?? null,
    position_x: frame.position.x,
    position_y: frame.position.y,
    current_gold: frame.currentGold,
    total_gold: frame.totalGold,
    gold_per_second: frame.goldPerSecond,
    minions_killed: frame.minionsKilled,
    jungle_minions_killed: frame.jungleMinionsKilled,
    level: frame.level,
    xp: frame.xp,
    time_enemy_spent_controlled: frame.timeEnemySpentControlled,
    ...championFrameStats(frame),
    ...damageFrameStats(frame),
  };
}

function timestampBounds(timestamps: readonly number[]): {
  first: number | null;
  last: number | null;
} {
  return timestamps.length === 0
    ? { first: null, last: null }
    : { first: Math.min(...timestamps), last: Math.max(...timestamps) };
}

/**
 * Convert one retained raw timeline into stable normalized relations. IDs use
 * Riot's ordered frame/event positions, so replaying the same object produces
 * byte-for-byte identical natural keys regardless of ingestion order.
 */
export function flattenTimeline(
  timeline: RawTimeline,
  observedAt: Date,
): FlattenedTimeline {
  const matchId = timeline.metadata.matchId;
  const observedAtText = lakeTimestamp(observedAt.getTime());
  const month = lakeMonth(observedAt.getTime());
  const puuidByParticipant = new Map(
    timeline.info.participants.map((participant) => [
      participant.participantId,
      participant.puuid,
    ]),
  );
  const events: TimelineEventLakeRow[] = [];
  const eventParticipants: TimelineEventParticipantLakeRow[] = [];
  const participantFrames: TimelineParticipantFrameLakeRow[] = [];

  for (const [frameIndex, frame] of timeline.info.frames.entries()) {
    for (const [index, event] of frame.events.entries()) {
      const id = eventId(matchId, frameIndex, index);
      events.push(
        flattenEvent({
          event,
          id,
          matchId,
          month,
          observedAt: observedAtText,
          frameIndex,
          eventIndex: index,
          frameTimestampMs: frame.timestamp,
        }),
      );
      eventParticipants.push(
        ...eventParticipantRows({
          event,
          id,
          matchId,
          month,
          observedAt: observedAtText,
          puuidByParticipant,
        }),
      );
    }
    for (const participantFrame of Object.values(
      frame.participantFrames ?? {},
    )) {
      participantFrames.push(
        participantFrameRow({
          frame: participantFrame,
          frameIndex,
          frameTimestampMs: frame.timestamp,
          matchId,
          month,
          observedAt: observedAtText,
          puuidByParticipant,
        }),
      );
    }
  }

  const timestamps = timeline.info.frames.map((frame) => frame.timestamp);
  const bounds = timestampBounds(timestamps);
  const coverage: TimelineCoverageLakeRow[] = [
    {
      match_id: matchId,
      month,
      observed_at: observedAtText,
      coverage_state: "complete",
      data_version: timeline.metadata.dataVersion,
      frame_interval_ms: timeline.info.frameInterval,
      frame_count: timeline.info.frames.length,
      event_count: events.length,
      participant_count: timeline.info.participants.length,
      first_frame_timestamp_ms: bounds.first,
      last_frame_timestamp_ms: bounds.last,
    },
  ];
  return { events, eventParticipants, participantFrames, coverage };
}
