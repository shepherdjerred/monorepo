import { describe, expect, test } from "vitest";
import {
  RawSummonerLeagueListSchema,
  RawSummonerLeagueSchema,
  StandardSummonerLeagueSchema,
} from "#src/league/raw-summoner-league.schema.ts";

describe("RawSummonerLeagueSchema", () => {
  test("validates a published Solo/Duo rank", () => {
    const result = RawSummonerLeagueSchema.safeParse({
      leagueId: "63b651bb-83df-40d3-92f7-7fa56a6a2491",
      queueType: "RANKED_SOLO_5x5",
      tier: "EMERALD",
      rank: "IV",
      summonerId: "some-summoner-id",
      puuid: "some-puuid",
      leaguePoints: 42,
      wins: 30,
      losses: 25,
      veteran: false,
      inactive: false,
      freshBlood: false,
      hotStreak: true,
    });

    expect(result.success).toBe(true);
  });

  test("normalizes omitted zero-valued numeric fields for relevant queues", () => {
    const result = StandardSummonerLeagueSchema.parse({
      queueType: "RANKED_FLEX_SR",
      tier: "GOLD",
      rank: "III",
    });

    expect(result.leaguePoints).toBe(0);
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
  });

  test("validates Ranked 5s as a distinct League-V4 ladder", () => {
    const result = StandardSummonerLeagueSchema.safeParse({
      queueType: "RANKED_TEAM_5x5",
      tier: "PLATINUM",
      rank: "II",
      leaguePoints: 35,
      wins: 9,
      losses: 4,
    });
    expect(result.success).toBe(true);
  });

  test("accepts future queue names without interpreting their fields", () => {
    const result = RawSummonerLeagueSchema.safeParse({
      queueType: "RANKED_FUTURE_MODE",
      tier: { future: true },
      rank: 9001,
      wins: "unknown-contract",
    });

    expect(result.success).toBe(true);
  });

  test("accepts observed Arena and TFT variants alongside valid ranks", () => {
    const result = RawSummonerLeagueListSchema.safeParse([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 75,
        wins: 100,
        losses: 80,
      },
      {
        queueType: "CHERRY",
        ratedTier: "WOOD",
        ratedRating: 1200,
      },
      {
        queueType: "RANKED_TFT_SET_14",
        tier: "MASTER",
        rank: "I",
      },
    ]);

    expect(result.success).toBe(true);
  });

  test.each([
    { tier: "INVALID_TIER", rank: "I" },
    { tier: "GOLD", rank: "V" },
    { tier: undefined, rank: "II" },
    { tier: "GOLD", rank: undefined },
  ])("rejects malformed relevant entries: %o", ({ tier, rank }) => {
    const result = RawSummonerLeagueSchema.safeParse({
      queueType: "RANKED_SOLO_5x5",
      tier,
      rank,
    });

    expect(result.success).toBe(false);
  });

  test("rejects empty queue names", () => {
    expect(RawSummonerLeagueSchema.safeParse({ queueType: "" }).success).toBe(
      false,
    );
  });

  test("keeps unknown fields visible to strict-field auditing", () => {
    const result = RawSummonerLeagueSchema.safeParse({
      queueType: "RANKED_SOLO_5x5",
      tier: "GOLD",
      rank: "II",
      newRiotField: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.code === "unrecognized_keys"),
      ).toBe(true);
    }
  });
});
