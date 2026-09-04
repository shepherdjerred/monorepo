import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  TimelineCoverageLakeRow,
  TimelineEventParticipantLakeRow,
  TimelineEventLakeRow,
  TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import {
  fetchChampionComparisons,
  fetchFullMatch,
  fetchTimelineCoverage,
  fetchTimelineEventPage,
  fetchTimelineFramePage,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-consumer-lake-"));
const playerOne = testPuuid("comparison-one");
const playerTwo = testPuuid("comparison-two");
const matchId = "NA1_timeline_detail";

function event(options: {
  id: string;
  timestamp: number;
  type: string;
  participantId?: number;
  goldGain?: number;
}): TimelineEventLakeRow {
  return {
    event_id: options.id,
    match_id: matchId,
    month: "2026-08",
    observed_at: "2026-08-20 12:30:00.000",
    frame_index: Math.floor(options.timestamp / 60_000),
    event_index: options.timestamp,
    frame_timestamp_ms: options.timestamp,
    event_timestamp_ms: options.timestamp,
    event_type: options.type,
    participant_id: options.participantId ?? null,
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
    gold_gain: options.goldGain ?? null,
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
  };
}

function frame(options: {
  index: number;
  timestamp: number;
  participantId: number;
  puuid: string;
}): TimelineParticipantFrameLakeRow {
  return {
    match_id: matchId,
    month: "2026-08",
    observed_at: "2026-08-20 12:30:00.000",
    frame_index: options.index,
    frame_timestamp_ms: options.timestamp,
    participant_id: options.participantId,
    puuid: options.puuid,
    position_x: 100,
    position_y: 200,
    current_gold: 300,
    total_gold: 1000 + options.timestamp,
    gold_per_second: 20,
    minions_killed: 10,
    jungle_minions_killed: 2,
    level: 3,
    xp: 500 + options.timestamp,
    time_enemy_spent_controlled: 1.5,
    ability_haste: 0,
    ability_power: 0,
    armor: 30,
    attack_damage: 60,
    attack_speed: 0.7,
    health: 700,
    health_max: 800,
    magic_resist: 30,
    movement_speed: 340,
    power: 300,
    power_max: 400,
    total_damage_done: 2000,
    total_damage_done_to_champions: 300,
    total_damage_taken: 250,
  };
}

function eventParticipant(options: {
  eventId: string;
  participantId: number;
  role: TimelineEventParticipantLakeRow["role"];
}): TimelineEventParticipantLakeRow {
  return {
    event_id: options.eventId,
    match_id: matchId,
    month: "2026-08",
    observed_at: "2026-08-20 12:30:00.000",
    participant_id: options.participantId,
    puuid: options.participantId === 1 ? playerOne : playerTwo,
    role: options.role,
    role_index: 0,
  };
}

const coverage: TimelineCoverageLakeRow = {
  match_id: matchId,
  month: "2026-08",
  observed_at: "2026-08-20 12:30:00.000",
  coverage_state: "complete",
  data_version: "2",
  frame_interval_ms: 60_000,
  frame_count: 2,
  event_count: 3,
  participant_count: 2,
  first_frame_timestamp_ms: 60_000,
  last_frame_timestamp_ms: 120_000,
};

beforeAll(async () => {
  await resetTestLake(lakeDir);
  const created = new Date("2026-08-20T12:00:00.000Z");
  await writeTestLake(lakeDir, {
    serverId: "100000000000000041",
    matchFacts: Array.from({ length: 22 }, (_, index) => ({
      playerId: 1,
      playerAlias: "One",
      matchId: index === 0 ? matchId : `NA1_one_${index.toString()}`,
      puuid: playerOne,
      queue: index === 21 ? null : index % 2 === 0 ? "solo" : "flex",
      win: index % 2 === 0,
      surrendered: false,
      kills: 4,
      deaths: 2,
      assists: 6,
      championId: 22,
      championName: "Ashe",
      gameCreationAt: new Date(created.getTime() - index * 60_000),
    })),
    untrackedMatchFacts: [
      {
        playerId: 2,
        playerAlias: "Two",
        matchId,
        puuid: playerTwo,
        queue: "solo",
        win: false,
        surrendered: false,
        kills: 2,
        deaths: 4,
        assists: 3,
        teamId: 200,
        championId: 86,
        championName: "Garen",
        gameCreationAt: created,
      },
    ],
    timelineEvents: [
      event({ id: "late", timestamp: 180_000, type: "CHAMPION_KILL" }),
      event({
        id: "early",
        timestamp: 60_000,
        type: "ITEM_PURCHASED",
        participantId: 1,
      }),
      event({
        id: "unknown",
        timestamp: 120_000,
        type: "RIFT_HERALD_DANCE",
        goldGain: 17,
      }),
    ],
    timelineEventParticipants: [
      eventParticipant({ eventId: "early", participantId: 1, role: "subject" }),
      eventParticipant({
        eventId: "unknown",
        participantId: 1,
        role: "assist",
      }),
    ],
    timelineFrames: [
      frame({
        index: 1,
        timestamp: 120_000,
        participantId: 2,
        puuid: playerTwo,
      }),
      frame({
        index: 0,
        timestamp: 60_000,
        participantId: 1,
        puuid: playerOne,
      }),
    ],
    timelineCoverage: [coverage],
  });
});

afterAll(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("consumer profile lake reads", () => {
  test("applies multi-queue and newest-N champion scopes without excluding null from all games", async () => {
    const lastTwenty = await fetchChampionComparisons({
      championId: 22,
      entries: [{ entryKey: "one", puuids: [playerOne] }],
      games: 20,
      queues: ["solo", "flex"],
      lakeDir,
    });
    expect(lastTwenty[0]?.games).toBe(20);

    const all = await fetchChampionComparisons({
      championId: 22,
      entries: [{ entryKey: "one", puuids: [playerOne] }],
      games: "all",
      lakeDir,
    });
    expect(all[0]?.games).toBe(22);
  });

  test("returns the complete stored scoreboard", async () => {
    const rows = await fetchFullMatch({ matchId, lakeDir });
    expect(rows.map((row) => row.champion_name)).toEqual(["Ashe", "Garen"]);
  });

  test("keeps chronological event and frame pages, filters, and unknown event fields", async () => {
    expect(await fetchTimelineCoverage({ matchId, lakeDir })).toMatchObject({
      event_count: 3,
      frame_count: 2,
    });
    const events = await fetchTimelineEventPage({
      matchId,
      offset: 0,
      limit: 2,
      lakeDir,
    });
    expect(events.map((row) => row.event_id)).toEqual(["early", "unknown"]);
    expect(events[1]).toMatchObject({
      event_type: "RIFT_HERALD_DANCE",
      gold_gain: 17,
    });
    const laterEvents = await fetchTimelineEventPage({
      matchId,
      offset: 2,
      limit: 2,
      lakeDir,
    });
    expect(laterEvents.map((row) => row.event_id)).toEqual(["late"]);
    const filtered = await fetchTimelineEventPage({
      matchId,
      offset: 0,
      limit: 100,
      participantIds: [1],
      lakeDir,
    });
    expect(filtered.map((row) => row.event_id)).toEqual(["early", "unknown"]);
    const frames = await fetchTimelineFramePage({
      matchId,
      offset: 0,
      limit: 1,
      lakeDir,
    });
    expect(frames.map((row) => row.participant_id)).toEqual([1]);
    const laterFrames = await fetchTimelineFramePage({
      matchId,
      offset: 1,
      limit: 1,
      lakeDir,
    });
    expect(laterFrames.map((row) => row.participant_id)).toEqual([2]);
  });

  test("returns null when Scout never retained timeline coverage", async () => {
    expect(
      await fetchTimelineCoverage({ matchId: "NA1_missing", lakeDir }),
    ).toBeNull();
  });
});
