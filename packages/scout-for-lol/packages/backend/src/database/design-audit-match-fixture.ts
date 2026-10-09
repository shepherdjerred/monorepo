import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  TimelineEventLakeRowSchema,
  TimelineParticipantFrameLakeRowSchema,
  type TimelineCoverageLakeRow,
  type TimelineEventParticipantLakeRow,
} from "@scout-for-lol/data";
import type { TestLakeMatchFact } from "#src/testing/test-report-lake.ts";

type Common = { match_id: string; month: string; observed_at: string };

export function designAuditHistoryFixtures(
  player: Pick<
    TestLakeMatchFact,
    "playerId" | "playerAlias" | "puuid" | "discordId"
  >,
): TestLakeMatchFact[] {
  return Array.from({ length: 21 }, (_, index) => ({
    ...player,
    matchId: RiotMatchIdSchema.parse(
      `NA1_${(9_300_000_000 + index).toString()}`,
    ),
    queue: "solo",
    win: index % 2 === 0,
    surrendered: false,
    kills: 5,
    deaths: 3,
    assists: 8,
    championId: 222,
    championName: "Jinx",
    gameCreationAt: new Date(Date.UTC(2025, 11, 27 - index, 12)),
  }));
}
function extraPlayers(game: number, matchId: RiotMatchId): TestLakeMatchFact[] {
  const roles = ["TOP", "JUNGLE", "MIDDLE", "UTILITY"];
  const champions = [
    { id: 86, name: "Garen" },
    { id: 64, name: "LeeSin" },
    { id: 103, name: "Ahri" },
    { id: 89, name: "Leona" },
  ];
  const extra: TestLakeMatchFact[] = [];

  for (let i = 0; i < 8; i++) {
    const champion = champions[i % 4];
    if (champion === undefined) throw new Error("Missing audit champion");
    extra.push({
      playerId: 1001 + i,
      playerAlias:
        i === 0
          ? "A deliberately long player name"
          : `Player ${(i + 1).toString()}`,
      matchId,
      puuid: `audit-${i.toString()}`.padEnd(78, "x"),
      queue: game % 2 === 0 ? "flex" : "solo",
      win: i < 4 === game < 3,
      surrendered: false,
      kills: 5 + (i % 3),
      deaths: 4,
      assists: 6,
      teamId: i < 4 ? 100 : 200,
      teamPosition: roles[i % 4],
      championId: champion.id,
      championName: champion.name,
      gameCreationAt: new Date(
        game === 1
          ? "2026-01-01T12:00:00.000Z"
          : `2025-12-${(32 - game).toString()}T18:00:00.000Z`,
      ),
      gameDurationSeconds: game === 2 ? 600 : 1800,
    });
  }

  return extra;
}
function framesForGame(common: Common, minutes: number, ids: number[]) {
  const timelineFrames = [];
  for (let minute = 0; minute <= minutes; minute++) {
    for (const [index, id] of ids.entries()) {
      timelineFrames.push(makeFrame(common, minute, index, id));
    }
  }

  return timelineFrames;
}
function eventsForGame(
  common: Common,
  minutes: number,
  playerId: number,
  game: number,
) {
  const count = minutes * 2;
  const timelineEvents = [];
  const timelineEventParticipants: TimelineEventParticipantLakeRow[] = [];
  for (let index = 0; index < count; index++) {
    const event = makeEvent(common, index, count, { playerId, game });
    const eventId = event.event_id;
    timelineEvents.push(event);
    timelineEventParticipants.push({
      ...common,
      event_id: eventId,
      participant_id: playerId,
      puuid: null,
      role: "killer",
      role_index: 0,
    });
  }

  return { timelineEvents, timelineEventParticipants };
}
/** Ten-player competitive games, including a short game and missing timelines. */
export function designAuditMatchFixtures(playerId: number) {
  const extra = [];
  const timelineFrames = [];
  const timelineEvents = [];
  const timelineCoverage: TimelineCoverageLakeRow[] = [];
  const timelineEventParticipants: TimelineEventParticipantLakeRow[] = [];
  for (let game = 1; game <= 4; game++) {
    const matchId = RiotMatchIdSchema.parse(
      `NA1_${(9_200_000_000 + game).toString()}`,
    );
    extra.push(...extraPlayers(game, matchId));
    if (game > 2) continue;
    const minutes = game === 2 ? 10 : 30;
    const ids = [
      playerId,
      900 + game,
      ...Array.from({ length: 8 }, (_, i) => 1001 + i),
    ];
    const common = {
      match_id: matchId,
      month: game === 1 ? "2026-01" : "2025-12",
      observed_at: "2026-01-01 13:00:00",
    };
    timelineFrames.push(...framesForGame(common, minutes, ids));
    const events = eventsForGame(common, minutes, playerId, game);
    timelineEvents.push(...events.timelineEvents);
    timelineEventParticipants.push(...events.timelineEventParticipants);
    timelineCoverage.push({
      ...common,
      coverage_state: "complete",
      data_version: "2",
      frame_interval_ms: 60_000,
      frame_count: minutes + 1,
      event_count: events.timelineEvents.length,
      participant_count: 10,
      first_frame_timestamp_ms: 0,
      last_frame_timestamp_ms: minutes * 60_000,
    });
  }
  return {
    extra,
    timelineFrames,
    timelineEvents,
    timelineCoverage,
    timelineEventParticipants,
  };
}

function makeFrame(common: Common, minute: number, index: number, id: number) {
  const blue = index === 0 || (index >= 2 && index < 6);
  return TimelineParticipantFrameLakeRowSchema.parse({
    ...common,
    frame_index: minute,
    frame_timestamp_ms: minute * 60_000,
    participant_id: id,
    puuid: null,
    position_x:
      minute === 0
        ? blue
          ? 500
          : 14_500
        : 2000 + ((index * 1270 + minute * 300) % 11_000),
    position_y:
      minute === 0
        ? blue
          ? 500
          : 14_500
        : 2000 + ((index * 970 + minute * 500) % 11_000),
    current_gold: 200,
    total_gold: 500 + minute * (blue ? 340 : 315) + index * minute * 5,
    gold_per_second: 2,
    minions_killed: minute * 6,
    jungle_minions_killed: index === 3 || index === 7 ? minute * 3 : 0,
    level: Math.min(18, 1 + Math.floor(minute * 0.6)),
    xp: minute * (blue ? 420 : 400),
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

function keyEventType(end: boolean, building: boolean, objective: boolean) {
  if (end) return "GAME_END";
  if (building) return "BUILDING_KILL";
  return objective ? "ELITE_MONSTER_KILL" : "CHAMPION_KILL";
}

function makeEvent(
  common: Common,
  index: number,
  count: number,
  player: { playerId: number; game: number },
) {
  const { playerId, game } = player;
  const timestamp = (index + 1) * 30_000;
  const objective = index >= 9 && (index - 9) % 12 === 0;
  const building = index % 13 === 0 && index > 13;
  const end = index === count - 1;
  const eventId = `${common.match_id}-event-${index.toString()}`;
  return TimelineEventLakeRowSchema.parse({
    ...common,
    event_id: eventId,
    frame_index: Math.ceil(timestamp / 60_000),
    event_index: index,
    frame_timestamp_ms: Math.ceil(timestamp / 60_000) * 60_000,
    event_timestamp_ms: timestamp,
    event_type: keyEventType(end, building, objective),
    killer_id: playerId,
    victim_id: objective || building || end ? null : 900 + game,
    killer_team_id: 100,
    team_id: building ? 200 : null,
    participant_id: null,
    creator_id: null,
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
    building_type: building ? "TOWER_BUILDING" : null,
    lane_type: building ? "BOT_LANE" : null,
    tower_type: building ? "OUTER_TURRET" : null,
    monster_type: objective ? "DRAGON" : null,
    monster_sub_type: objective ? "FIRE_DRAGON" : null,
    level_up_type: null,
    winning_team_id: end ? 100 : null,
    real_timestamp_ms: null,
  });
}
