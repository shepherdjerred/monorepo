import { describe, expect, it } from "bun:test";
import type { RawMatch, RawParticipant, Rank, Ranks } from "@scout-for-lol/data";
import {
  AccountIdSchema,
  ChampionIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { processCriteria } from "@scout-for-lol/backend/league/competition/processors/index.ts";
import type { PlayerWithAccounts } from "@scout-for-lol/backend/league/competition/processors/types.ts";

import { testAccountId, testPuuid } from "@scout-for-lol/backend/testing/test-ids.ts";
// ============================================================================
// Test Fixtures - Load Real Match Data
// ============================================================================

async function loadMatch(path: string): Promise<RawMatch> {
  const content = await Bun.file(path).text();
  return RawMatchSchema.parse(JSON.parse(content));
}

// ============================================================================
// Test Fixtures - Players
// ============================================================================

// These should match PUUIDs from real match data
const testPlayers: PlayerWithAccounts[] = [
  {
    id: PlayerIdSchema.parse(1),
    alias: "TestPlayer1",
    discordId: testAccountId("100000000"),
    accounts: [
      {
        id: AccountIdSchema.parse(1),
        alias: "TestPlayer1",
        puuid: testPuuid("test-1"), // Replace with actual PUUID from fixture if available
        region: "AMERICA_NORTH",
      },
    ],
  },
  {
    id: PlayerIdSchema.parse(2),
    alias: "TestPlayer2",
    discordId: testAccountId("200000000"),
    accounts: [
      {
        id: AccountIdSchema.parse(2),
        alias: "TestPlayer2",
        puuid: testPuuid("test-2"),
        region: "AMERICA_NORTH",
      },
    ],
  },
];

// ============================================================================
// Integration Tests
// ============================================================================

/**
 * Create test player from PUUID
 */
function createTestPlayerFromPuuid(puuid: string, index: number): PlayerWithAccounts {
  return {
    id: PlayerIdSchema.parse(index + 1),
    alias: `Player${(index + 1).toString()}`,
    discordId: testAccountId((index + 1).toString()),
    accounts: [
      {
        id: AccountIdSchema.parse(index + 1),
        alias: `Player${(index + 1).toString()}`,
        puuid: LeaguePuuidSchema.parse(puuid),
        region: "AMERICA_NORTH",
      },
    ],
  };
}

/**
 * Create test player from participant
 */
function createTestPlayerFromParticipant(participant: RawParticipant): PlayerWithAccounts {
  return {
    id: PlayerIdSchema.parse(1),
    alias: "TestPlayer",
    discordId: testAccountId("100000000"),
    accounts: [
      {
        id: AccountIdSchema.parse(1),
        alias: "TestPlayer",
        puuid: LeaguePuuidSchema.parse(participant.puuid),
        region: "AMERICA_NORTH",
      },
    ],
  };
}

/**
 * Test empty match data handling
 */
function testEmptyMatchData() {
  const emptyMatches: RawMatch[] = [];
  const players = testPlayers;

  // Test all criteria types with empty matches
  const gamesResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "SOLO" }, emptyMatches, players);
  expect(gamesResult).toBeDefined();
  expect(gamesResult.every((entry) => entry.score === 0)).toBe(true);

  const winsResult = processCriteria({ type: "MOST_WINS_PLAYER", queue: "SOLO" }, emptyMatches, players);
  expect(winsResult).toBeDefined();
  expect(winsResult.every((entry) => entry.score === 0)).toBe(true);

  const championResult = processCriteria(
    { type: "MOST_WINS_CHAMPION", championId: ChampionIdSchema.parse(157), queue: "SOLO" },
    emptyMatches,
    players,
  );
  expect(championResult).toBeDefined();
  expect(championResult.every((entry) => entry.score === 0)).toBe(true);
}

describe("processCriteria integration tests", () => {
  it("should process real match data without crashing", async () => {
    const matchPath = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match = await loadMatch(matchPath);

    // Extract actual PUUIDs from the match
    const puuids = match.metadata.participants.slice(0, 2); // Take first 2 players

    // Create players with actual PUUIDs
    const players: PlayerWithAccounts[] = puuids.map((puuid, index) => createTestPlayerFromPuuid(puuid, index));

    // Test MOST_GAMES_PLAYED
    const gamesResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "SOLO" }, [match], players);

    expect(gamesResult).toBeDefined();
    expect(gamesResult.length).toBe(players.length);
    // Verify all entries have numeric scores (all should be >= 0)
    for (const entry of gamesResult) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("should handle empty match data gracefully", () => {
    testEmptyMatchData();
  });

  it("should correctly filter by queue type", async () => {
    const matchPath = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match = await loadMatch(matchPath);
    const queueId = match.info.queueId;

    // Extract actual PUUIDs from the match
    const puuid = match.metadata.participants[0];
    if (!puuid) {
      throw new Error("No participants in match fixture");
    }

    const player = createTestPlayerFromPuuid(puuid, 0);

    // Test matching queue filter
    // queueId 1700 = ARENA, 420 = SOLO, 440 = FLEX
    if (queueId === 420) {
      // SOLO queue match
      const matchingResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "SOLO" }, [match], [player]);
      expect(matchingResult[0]?.score).toBe(1);

      const nonMatchingResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "ARENA" }, [match], [player]);
      expect(nonMatchingResult[0]?.score).toBe(0);
    } else if (queueId === 1700) {
      // ARENA queue match
      const matchingResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "ARENA" }, [match], [player]);
      expect(matchingResult[0]?.score).toBe(1);

      const nonMatchingResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "SOLO" }, [match], [player]);
      expect(nonMatchingResult[0]?.score).toBe(0);
    } else {
      // Unknown queue type - just verify ALL works
      const allResult = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "ALL" }, [match], [player]);
      expect(allResult[0]?.score).toBe(1);
    }
  });

  it("should calculate wins and losses correctly from real data", async () => {
    const matchPath = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match = await loadMatch(matchPath);

    // Get first participant and their win status
    const firstParticipant = match.info.participants[0];
    if (!firstParticipant) {
      throw new Error("No participants in match fixture");
    }

    const player = createTestPlayerFromParticipant(firstParticipant);

    const result = processCriteria({ type: "MOST_WINS_PLAYER", queue: "ALL" }, [match], [player]);

    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(player.id);
    expect(result[0]?.metadata?.["wins"]).toBeDefined();
    expect(result[0]?.metadata?.["losses"]).toBeDefined();
    expect(result[0]?.metadata?.["games"]).toBe(1);

    // Verify win/loss matches participant data
    if (firstParticipant.win) {
      expect(result[0]?.score).toBe(1);
      expect(result[0]?.metadata?.["wins"]).toBe(1);
      expect(result[0]?.metadata?.["losses"]).toBe(0);
    } else {
      expect(result[0]?.score).toBe(0);
      expect(result[0]?.metadata?.["wins"]).toBe(0);
      expect(result[0]?.metadata?.["losses"]).toBe(1);
    }
  });

  it("should handle multiple matches from same player", async () => {
    const match1Path = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match2Path = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370986469.json`;

    const match1 = await loadMatch(match1Path);
    const match2 = await loadMatch(match2Path);

    // Find a common PUUID if exists, otherwise use first participant from first match
    const puuid = match1.metadata.participants[0];
    if (!puuid) {
      throw new Error("No participants in match fixture");
    }

    const player: PlayerWithAccounts = {
      id: PlayerIdSchema.parse(1),
      alias: "TestPlayer",
      discordId: testAccountId("100000000"),
      accounts: [
        {
          id: AccountIdSchema.parse(1),
          alias: "TestPlayer",
          puuid: LeaguePuuidSchema.parse(puuid),
          region: "AMERICA_NORTH",
        },
      ],
    };

    const result = processCriteria({ type: "MOST_GAMES_PLAYED", queue: "ALL" }, [match1, match2], [player]);

    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(player.id);

    // Player should have at least 1 game (might have 2 if they're in both matches)
    expect(result[0]?.score).toBeGreaterThanOrEqual(1);
    expect(result[0]?.score).toBeLessThanOrEqual(2);
  });

  it("should handle rank-based criteria with snapshot data", () => {
    const goldRank: Rank = {
      tier: "gold",
      division: 3,
      lp: 45,
      wins: 50,
      losses: 45,
    };

    const platinumRank: Rank = {
      tier: "platinum",
      division: 2,
      lp: 60,
      wins: 80,
      losses: 70,
    };

    const player1 = testPlayers[0];
    const player2 = testPlayers[1];
    if (!player1 || !player2) {
      throw new Error("Test players not defined");
    }

    const currentRanks: Record<number, Ranks> = {
      [player1.id]: { solo: platinumRank },
      [player2.id]: { solo: goldRank },
    };

    const result = processCriteria({ type: "HIGHEST_RANK", queue: "SOLO" }, [], testPlayers, {
      currentRanks,
      startSnapshots: {},
      endSnapshots: {},
    });

    expect(result.length).toBe(2);
    expect(result[0]?.score).toEqual(platinumRank);
    expect(result[1]?.score).toEqual(goldRank);
  });

  it("should correctly filter by champion ID", async () => {
    const matchPath = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match = await loadMatch(matchPath);

    // Get first participant and their champion
    const firstParticipant = match.info.participants[0];
    if (!firstParticipant) {
      throw new Error("No participants in match fixture");
    }

    const player: PlayerWithAccounts = {
      id: PlayerIdSchema.parse(1),
      alias: "TestPlayer",
      discordId: testAccountId("100000000"),
      accounts: [
        {
          id: AccountIdSchema.parse(1),
          alias: "TestPlayer",
          puuid: LeaguePuuidSchema.parse(firstParticipant.puuid),
          region: "AMERICA_NORTH",
        },
      ],
    };

    // Test with matching champion ID
    const matchingResult = processCriteria(
      { type: "MOST_WINS_CHAMPION", championId: ChampionIdSchema.parse(firstParticipant.championId), queue: "ALL" },
      [match],
      [player],
    );

    expect(matchingResult[0]?.metadata?.["championId"]).toBe(firstParticipant.championId);
    expect(matchingResult[0]?.metadata?.["games"]).toBe(1);

    // Test with non-matching champion ID
    const nonMatchingResult = processCriteria(
      { type: "MOST_WINS_CHAMPION", championId: ChampionIdSchema.parse(9999), queue: "ALL" }, // Champion ID that doesn't exist
      [match],
      [player],
    );

    expect(nonMatchingResult[0]?.score).toBe(0);
    expect(nonMatchingResult[0]?.metadata?.["games"]).toBe(0);
  });

  it("should handle win rate calculation with real data", async () => {
    const matchPath = `${import.meta.dir}/../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
    const match = await loadMatch(matchPath);

    const firstParticipant = match.info.participants[0];
    if (!firstParticipant) {
      throw new Error("No participants in match fixture");
    }

    const player: PlayerWithAccounts = {
      id: PlayerIdSchema.parse(1),
      alias: "TestPlayer",
      discordId: testAccountId("100000000"),
      accounts: [
        {
          id: AccountIdSchema.parse(1),
          alias: "TestPlayer",
          puuid: LeaguePuuidSchema.parse(firstParticipant.puuid),
          region: "AMERICA_NORTH",
        },
      ],
    };

    // With only 1 match and minGames=1, player should be included
    const result = processCriteria({ type: "HIGHEST_WIN_RATE", minGames: 1, queue: "ALL" }, [match], [player]);

    expect(result.length).toBe(1);
    expect(result[0]?.metadata?.["games"]).toBe(1);
    expect(result[0]?.metadata?.["winRate"]).toBeDefined();

    // Win rate should be either 0 or 1 (since only 1 game)
    const winRate = result[0]?.metadata?.["winRate"];
    expect(winRate === 0 || winRate === 1).toBe(true);

    // Test with minGames too high - should exclude player
    const filteredResult = processCriteria({ type: "HIGHEST_WIN_RATE", minGames: 10, queue: "ALL" }, [match], [player]);
    expect(filteredResult.length).toBe(0);
  });
});
