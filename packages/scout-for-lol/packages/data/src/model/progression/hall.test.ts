import { describe, expect, test } from "vitest";
import type { MatchLakeRow } from "#src/model/lake-columns.ts";
import {
  classifyHallQueueFamily,
  compareHallCandidate,
  hallRecordValue,
  isHallEligibleMatch,
  type HallCandidate,
  type HallRecordHolder,
} from "./hall.ts";
import { HallRecordIdSchema } from "./catalog.ts";

function matchRow(): MatchLakeRow {
  return {
    match_id: "NA1_1",
    game_id: "1",
    platform_id: "NA1",
    month: "2026-01",
    game_creation_at: "2026-01-01 00:00:00.000",
    game_start_at: "2026-01-01 00:00:00.000",
    game_end_at: "2026-01-01 00:30:00.000",
    game_duration_seconds: 1800,
    queue_id: 420,
    queue: "solo",
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_version: "16.1.1",
    end_of_game_result: "GameComplete",
    map_id: 11,
    puuid: "puuid-1",
    participant_id: 1,
    team_id: 100,
    riot_id_game_name: "Player",
    riot_id_tagline: "NA1",
    summoner_name: "Player",
    champion_id: 22,
    champion_name: "Ashe",
    team_position: "BOTTOM",
    individual_position: "BOTTOM",
    lane: "BOTTOM",
    role: "CARRY",
    win: true,
    surrendered: false,
    early_surrendered: false,
    game_ended_in_surrender: false,
    game_ended_in_early_surrender: false,
    team_early_surrendered: false,
    kills: 14,
    deaths: 4,
    assists: 17,
    kda: 7.75,
    creep_score: 240,
    total_minions_killed: 230,
    neutral_minions_killed: 10,
    gold_earned: 16_000,
    gold_spent: 15_000,
    total_damage_dealt: 100_000,
    total_damage_dealt_to_champions: 30_000,
    magic_damage_dealt_to_champions: 3000,
    physical_damage_dealt_to_champions: 26_000,
    true_damage_dealt_to_champions: 1000,
    total_damage_taken: 22_000,
    damage_self_mitigated: 9000,
    damage_dealt_to_objectives: 12_000,
    damage_dealt_to_turrets: 6000,
    total_heal: 4000,
    total_heals_on_teammates: 700,
    vision_score: 28,
    wards_placed: 12,
    wards_killed: 5,
    vision_wards_bought_in_game: 2,
    detector_wards_placed: 2,
    all_in_pings: 0,
    assist_me_pings: 0,
    basic_pings: 0,
    command_pings: 0,
    danger_pings: 0,
    enemy_missing_pings: 0,
    enemy_vision_pings: 0,
    get_back_pings: 0,
    hold_pings: 0,
    need_vision_pings: 0,
    on_my_way_pings: 0,
    push_pings: 0,
    vision_cleared_pings: 0,
    double_kills: 2,
    triple_kills: 1,
    quadra_kills: 0,
    penta_kills: 0,
    largest_multi_kill: 3,
    killing_sprees: 2,
    first_blood_kill: true,
    champ_level: 18,
    champ_experience: 18_000,
    time_played: 1800,
    total_time_spent_dead: 155,
    longest_time_spent_living: 815,
    time_ccing_others: 31,
    turret_kills: 2,
    inhibitor_kills: 1,
    baron_kills: 0,
    dragon_kills: 1,
    placement: null,
    subteam_placement: null,
    player_subteam_id: null,
  };
}

const holderOne: HallRecordHolder = {
  playerId: 1,
  playerAlias: "One",
  accountId: 10,
  accountAlias: "One#NA1",
  puuid: "puuid-one",
};

const holderTwo: HallRecordHolder = {
  playerId: 2,
  playerAlias: "Two",
  accountId: 20,
  accountAlias: "Two#NA1",
  puuid: "puuid-two",
};

function candidate(holder: HallRecordHolder, value: number): HallCandidate {
  return {
    queueFamilyId: "ranked_sr",
    recordId: "kills",
    value,
    holder,
    evidence: {
      matchId: `match-${holder.playerId.toString()}`,
      gameEndAt: "2026-01-01T00:30:00.000Z",
      value,
      holder,
    },
  };
}

describe("Hall of Fame domain", () => {
  test("groups every supported non-custom queue into the intended family", () => {
    expect(classifyHallQueueFamily("solo")).toBe("ranked_sr");
    expect(classifyHallQueueFamily("ranked 5s")).toBe("ranked_sr");
    expect(classifyHallQueueFamily("draft pick")).toBe("unranked_sr");
    expect(classifyHallQueueFamily("aram clash")).toBe("aram_clash");
    expect(classifyHallQueueFamily("arurf")).toBe("urf");
    expect(classifyHallQueueFamily("hard doom bots")).toBe("doom_bots_hard");
    expect(classifyHallQueueFamily("custom")).toBeNull();
  });

  test("computes every record comparator from match evidence", () => {
    const expected = {
      kills: 14,
      assists: 17,
      largest_multikill: 3,
      champion_damage: 30_000,
      champion_damage_per_minute: 1000,
      damage_taken: 22_000,
      damage_mitigated: 9000,
      cs: 240,
      cs_per_minute: 8,
      gold_earned: 16_000,
      teammate_healing: 700,
      vision_score: 28,
      wards_cleared: 5,
      objective_damage: 12_000,
      turret_damage: 6000,
      crowd_control_time: 31,
      longest_life: 815,
      total_time_dead: 155,
    };
    for (const recordId of HallRecordIdSchema.options) {
      expect(hallRecordValue(matchRow(), recordId), recordId).toBe(
        expected[recordId],
      );
    }
  });

  test("excludes pre-tracking games, remakes, and customs", () => {
    const match = matchRow();
    expect(isHallEligibleMatch(match, new Date("2025-12-31T00:00:00Z"))).toBe(
      true,
    );
    expect(isHallEligibleMatch(match, new Date("2026-01-02T00:00:00Z"))).toBe(
      false,
    );
    expect(
      isHallEligibleMatch(
        { ...match, early_surrendered: true },
        new Date("2025-12-31T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isHallEligibleMatch(
        { ...match, queue: "custom" },
        new Date("2025-12-31T00:00:00Z"),
      ),
    ).toBe(false);
  });

  test("only a greater value breaks a record and equal values add co-holders", () => {
    const existing = candidate(holderOne, 10);
    expect(
      compareHallCandidate(
        10,
        [holderOne],
        [existing.evidence],
        candidate(holderTwo, 9),
      ),
    ).toEqual({ kind: "below" });
    expect(
      compareHallCandidate(
        10,
        [holderOne],
        [existing.evidence],
        candidate(holderTwo, 10),
      ),
    ).toMatchObject({ kind: "tie", holders: [holderOne, holderTwo] });
    expect(
      compareHallCandidate(
        10,
        [holderOne],
        [existing.evidence],
        candidate(holderTwo, 11),
      ),
    ).toMatchObject({ kind: "break", value: 11, holders: [holderTwo] });
  });
});
