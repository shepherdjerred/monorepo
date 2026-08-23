import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  RawSummonerLeagueSchema,
  type RawSummonerLeague,
} from "#src/league/raw-summoner-league.schema.ts";

describe("RawSummonerLeagueSchema", () => {
  test("validates standard Solo/Duo ranked entry", () => {
    const data = {
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
    };

    const result = RawSummonerLeagueSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.queueType).toBe("RANKED_SOLO_5x5");
      expect(result.data.tier).toBe("EMERALD");
      expect(result.data.rank).toBe("IV");
    }
  });

  test("validates distinct queue types and tiers in closed enums", () => {
    const RawSummonerLeagueListSchema = z.array(RawSummonerLeagueSchema);
    const data = [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 75,
        wins: 100,
        losses: 80,
      },
      {
        queueType: "RANKED_PREMADE_5x5", // Clash / Premade 5s
        tier: "GOLD",
        rank: "I",
        leaguePoints: 51,
        wins: 6,
        losses: 2,
      },
      {
        queueType: "JADE_RANKED_SOLO_5x5", // Jade / Swiftplay
        tier: "SALT",
        rank: "II",
        leaguePoints: 68,
        wins: 3,
        losses: 3,
      },
      {
        queueType: "CHERRY", // Arena queue
        tier: "WOOD",
        ratedTier: "WOOD",
        ratedRating: 1200,
      },
      {
        queueType: "RANKED_TFT_SET_14", // TFT set queue
        tier: "PLATINUM",
        rank: "I",
      },
    ];

    const result = RawSummonerLeagueListSchema.safeParse(data);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(5);
      expect(result.data[0]?.queueType).toBe("RANKED_SOLO_5x5");
      expect(result.data[1]?.queueType).toBe("RANKED_PREMADE_5x5");
      expect(result.data[2]?.queueType).toBe("JADE_RANKED_SOLO_5x5");
      expect(result.data[2]?.tier).toBe("SALT");
      expect(result.data[3]?.queueType).toBe("CHERRY");
      expect(result.data[4]?.queueType).toBe("RANKED_TFT_SET_14");
    }
  });

  test("rejects invalid queue types not in closed enum", () => {
    const data = {
      queueType: "INVALID_UNKNOWN_QUEUE_TYPE",
      tier: "DIAMOND",
      rank: "I",
    };

    const result = RawSummonerLeagueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects invalid tiers not in closed enum", () => {
    const data = {
      queueType: "RANKED_SOLO_5x5",
      tier: "INVALID_TIER",
      rank: "I",
    };

    const result = RawSummonerLeagueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects incomplete standard ranked entries", () => {
    const fields = ["leaguePoints", "wins", "losses"] as const;
    const queues = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] as const;

    for (const queueType of queues) {
      for (const field of fields) {
        const result = RawSummonerLeagueSchema.safeParse({
          queueType,
          tier: "GOLD",
          rank: "II",
          leaguePoints: 25,
          wins: 10,
          losses: 8,
          [field]: undefined,
        });

        expect(result.success).toBe(false);
      }
    }
  });

  test("validates provisional / unplaced entry with optional fields", () => {
    const data: RawSummonerLeague = {
      queueType: "RANKED_FLEX_SR",
      tier: "GOLD",
      rank: "III",
      leaguePoints: 0,
      wins: 1,
      losses: 2,
      provisional: true,
    };

    const result = RawSummonerLeagueSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provisional).toBe(true);
    }
  });
});
