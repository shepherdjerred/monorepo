import { describe, expect, test } from "vitest";
import { RawTimelineSchema } from "@scout-for-lol/data";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";

const TIMELINE = RawTimelineSchema.parse({
  metadata: {
    dataVersion: "2",
    matchId: "NA1_42",
    participants: ["puuid-one", "puuid-two", "puuid-three"],
  },
  info: {
    frameInterval: 60_000,
    gameId: 42,
    participants: [
      { participantId: 1, puuid: "puuid-one" },
      { participantId: 2, puuid: "puuid-two" },
      { participantId: 3, puuid: "puuid-three" },
    ],
    frames: [
      {
        timestamp: 60_000,
        events: [
          {
            type: "CHAMPION_KILL",
            timestamp: 61_234,
            killerId: 1,
            victimId: 2,
            assistingParticipantIds: [3],
            bounty: 300,
            position: { x: 100, y: 200 },
          },
        ],
        participantFrames: {
          "1": {
            participantId: 1,
            currentGold: 500,
            totalGold: 1000,
            goldPerSecond: 20,
            jungleMinionsKilled: 0,
            minionsKilled: 10,
            level: 2,
            xp: 400,
            position: { x: 100, y: 200 },
            timeEnemySpentControlled: 0,
            championStats: { abilityPower: 35, health: 700 },
            damageStats: { totalDamageDoneToChampions: 250 },
          },
        },
      },
    ],
  },
});

describe("flattenTimeline", () => {
  test("produces replay-stable event IDs and participant roles", () => {
    const observedAt = new Date("2026-08-31T20:00:00.000Z");
    const first = flattenTimeline(TIMELINE, observedAt);
    const replay = flattenTimeline(TIMELINE, observedAt);

    expect(replay).toEqual(first);
    expect(first.events).toMatchObject([
      {
        event_id: "NA1_42:0:0",
        match_id: "NA1_42",
        month: "2026-08",
        event_type: "CHAMPION_KILL",
        event_timestamp_ms: 61_234,
        killer_id: 1,
        victim_id: 2,
        bounty: 300,
      },
    ]);
    expect(first.eventParticipants).toEqual([
      {
        event_id: "NA1_42:0:0",
        match_id: "NA1_42",
        month: "2026-08",
        observed_at: "2026-08-31 20:00:00.000",
        participant_id: 1,
        puuid: "puuid-one",
        role: "killer",
        role_index: 0,
      },
      {
        event_id: "NA1_42:0:0",
        match_id: "NA1_42",
        month: "2026-08",
        observed_at: "2026-08-31 20:00:00.000",
        participant_id: 2,
        puuid: "puuid-two",
        role: "victim",
        role_index: 0,
      },
      {
        event_id: "NA1_42:0:0",
        match_id: "NA1_42",
        month: "2026-08",
        observed_at: "2026-08-31 20:00:00.000",
        participant_id: 3,
        puuid: "puuid-three",
        role: "assist",
        role_index: 0,
      },
    ]);
  });

  test("normalizes participant frames and declares complete coverage", () => {
    const flattened = flattenTimeline(
      TIMELINE,
      new Date("2026-08-31T20:00:00.000Z"),
    );

    expect(flattened.participantFrames).toMatchObject([
      {
        match_id: "NA1_42",
        frame_index: 0,
        participant_id: 1,
        puuid: "puuid-one",
        current_gold: 500,
        total_gold: 1000,
        ability_power: 35,
        total_damage_done_to_champions: 250,
      },
    ]);
    expect(flattened.coverage).toEqual([
      {
        match_id: "NA1_42",
        month: "2026-08",
        observed_at: "2026-08-31 20:00:00.000",
        coverage_state: "complete",
        data_version: "2",
        frame_interval_ms: 60_000,
        frame_count: 1,
        event_count: 1,
        participant_count: 3,
        first_frame_timestamp_ms: 60_000,
        last_frame_timestamp_ms: 60_000,
      },
    ]);
  });
});
