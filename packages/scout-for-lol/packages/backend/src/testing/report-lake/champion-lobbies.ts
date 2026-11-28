import {
  TimelineParticipantFrameLakeRowSchema,
  type DiscordAccountId,
  type LeaguePuuid,
  type RiotMatchId,
  type TimelineEventLakeRow,
  type TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";
import { testEventRow } from "#src/testing/report-lake/test-timeline-rows.ts";

/**
 * Ten-player Summoner's Rift lobbies for champion-page fixtures: five role
 * pairs, each seat tracked (a Scout player) or not (a stranger), and the
 * timeline frames that give each seat its gold around the 15:00 checkpoint.
 */

export type LobbyPosition = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export type LobbySeat = {
  /** The participant id, and for a tracked seat the Scout player id. */
  playerId: number;
  alias: string;
  puuid: LeaguePuuid;
  discordId?: DiscordAccountId;
  tracked: boolean;
  teamId: 100 | 200;
  position: LobbyPosition;
  championId: number;
  championName: string;
  /** Total gold in the frame stamped just after 15:00. */
  gold15: number;
  /**
   * What the seat bought and ran: item ids in purchase order (a minute apart,
   * written as timeline events unless the game has no timeline) and the
   * keystone rune.
   */
  build?: { purchases?: readonly number[]; keystone?: number };
};

/**
 * `full`: frames before, at and after 15:00. `ended-before-15`: a 14:30 game,
 * whose only frame is the 14:00 one. `none`: no timeline was captured.
 */
export type LobbyTimeline = "full" | "ended-before-15" | "none";

// Riot stamps the frame for minute N just after the minute.
const FRAME_14 = 840_303;
const FRAME_15 = 900_303;
const FRAME_16 = 960_303;

function frame(options: {
  matchId: RiotMatchId;
  createdAt: Date;
  seat: LobbySeat;
  frameIndex: number;
  timestampMs: number;
  totalGold: number;
}): TimelineParticipantFrameLakeRow {
  return TimelineParticipantFrameLakeRowSchema.parse({
    match_id: options.matchId,
    month: lakeMonth(options.createdAt.getTime()),
    observed_at: lakeTimestamp(options.createdAt.getTime() + 3_600_000),
    frame_index: options.frameIndex,
    frame_timestamp_ms: options.timestampMs,
    participant_id: options.seat.playerId,
    puuid: null,
    position_x: 5000,
    position_y: 5000,
    current_gold: 200,
    total_gold: options.totalGold,
    gold_per_second: 2,
    minions_killed: 120,
    jungle_minions_killed: 0,
    level: 11,
    xp: 8000,
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
  });
}

export function championLobby(options: {
  matchId: RiotMatchId;
  createdAt: Date;
  winningTeam: 100 | 200;
  seats: readonly LobbySeat[];
  timeline?: LobbyTimeline;
}): {
  tracked: TestLakeMatchFact[];
  untracked: TestLakeMatchFact[];
  timelineFrames: TimelineParticipantFrameLakeRow[];
  timelineEvents: TimelineEventLakeRow[];
} {
  const timeline = options.timeline ?? "full";
  const tracked: TestLakeMatchFact[] = [];
  const untracked: TestLakeMatchFact[] = [];
  const timelineFrames: TimelineParticipantFrameLakeRow[] = [];
  const timelineEvents: TimelineEventLakeRow[] = [];
  for (const seat of options.seats) {
    const fact: TestLakeMatchFact = {
      playerId: seat.playerId,
      playerAlias: seat.alias,
      ...(seat.discordId === undefined ? {} : { discordId: seat.discordId }),
      matchId: options.matchId,
      puuid: seat.puuid,
      queue: "solo",
      win: seat.teamId === options.winningTeam,
      surrendered: false,
      kills: 5,
      deaths: 3,
      assists: 7,
      teamId: seat.teamId,
      teamPosition: seat.position,
      championId: seat.championId,
      championName: seat.championName,
      gameCreationAt: options.createdAt,
      gameDurationSeconds: timeline === "ended-before-15" ? 870 : 1800,
      ...(seat.build?.keystone === undefined
        ? {}
        : { scoutQlLoadout: { perk0: seat.build.keystone } }),
    };
    (seat.tracked ? tracked : untracked).push(fact);
    const at = (frameIndex: number, timestampMs: number, totalGold: number) =>
      frame({
        matchId: options.matchId,
        createdAt: options.createdAt,
        seat,
        frameIndex,
        timestampMs,
        totalGold,
      });
    if (timeline === "none") continue;
    for (const [index, itemId] of (seat.build?.purchases ?? []).entries()) {
      timelineEvents.push(
        testEventRow(options.createdAt, {
          event_id: `${options.matchId}-${seat.playerId.toString()}-${index.toString()}`,
          match_id: options.matchId,
          event_type: "ITEM_PURCHASED",
          event_timestamp_ms: (index + 1) * 60_000,
          participant_id: seat.playerId,
          item_id: itemId,
        }),
      );
    }
    // The 14:00 frame is a decoy with the order reversed: a read that took
    // the wrong frame would flip every lane.
    timelineFrames.push(at(14, FRAME_14, 20_000 - seat.gold15));
    if (timeline === "ended-before-15") continue;
    timelineFrames.push(
      at(15, FRAME_15, seat.gold15),
      at(16, FRAME_16, 20_000 - seat.gold15),
    );
  }
  return { tracked, untracked, timelineFrames, timelineEvents };
}
