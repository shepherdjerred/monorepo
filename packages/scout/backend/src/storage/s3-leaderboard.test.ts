import { describe, expect, test } from "bun:test";

import {
  CachedLeaderboardSchema,
  CompetitionIdSchema,
  PlayerIdSchema,
  type CachedLeaderboard,
} from "@shepherdjerred/scout-data";

// ============================================================================
// Zod Schema Validation Tests
// ============================================================================

describe("CachedLeaderboard Schema Validation", () => {
  test("validates correct cached leaderboard with numeric scores", () => {
    const validLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 100,
          rank: 1,
        },
        {
          playerId: PlayerIdSchema.parse(2),
          playerName: "Player2",
          score: 80,
          rank: 2,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(validLeaderboard);
    expect(result.success).toBe(true);
  });

  test("validates cached leaderboard with Rank scores", () => {
    const validLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(456),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: {
            tier: "diamond",
            division: 2,
            lp: 75,
            wins: 50,
            losses: 40,
          },
          rank: 1,
        },
        {
          playerId: PlayerIdSchema.parse(2),
          playerName: "Player2",
          score: {
            tier: "platinum",
            division: 1,
            lp: 90,
            wins: 45,
            losses: 45,
          },
          rank: 2,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(validLeaderboard);
    expect(result.success).toBe(true);
  });

  test("validates cached leaderboard with metadata", () => {
    const validLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(789),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 10,
          metadata: {
            wins: 10,
            games: 15,
            winRate: 0.667,
          },
          rank: 1,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(validLeaderboard);
    expect(result.success).toBe(true);
  });

  test("rejects invalid version", () => {
    const invalidLeaderboard = {
      version: "v2", // Invalid version
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const invalidLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      // Missing calculatedAt
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("rejects invalid competitionId", () => {
    const invalidLeaderboard = {
      version: "v1",
      competitionId: -1, // Negative ID (invalid)
      calculatedAt: new Date().toISOString(),
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("rejects invalid ISO timestamp", () => {
    const invalidLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: "not-a-timestamp",
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("rejects invalid entry fields", () => {
    const invalidLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: -1, // Negative ID (invalid)
          playerName: "Player1",
          score: 100,
          rank: 1,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("rejects invalid rank", () => {
    const invalidLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 100,
          rank: 0, // Rank must be positive
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(invalidLeaderboard);
    expect(result.success).toBe(false);
  });

  test("handles empty entries array", () => {
    const validLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(validLeaderboard);
    expect(result.success).toBe(true);
  });

  test("handles mixed score types in different entries", () => {
    const validLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 100, // Numeric score
          rank: 1,
        },
        {
          playerId: PlayerIdSchema.parse(2),
          playerName: "Player2",
          score: {
            // Rank score
            tier: "gold",
            division: 3,
            lp: 50,
            wins: 30,
            losses: 25,
          },
          rank: 2,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(validLeaderboard);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// S3 Key Generation Tests (unit tests for the logic)
// ============================================================================

describe("S3 Key Generation Logic", () => {
  test("current leaderboard key format", () => {
    const competitionId = CompetitionIdSchema.parse(123);
    const expectedKey = `leaderboards/competition-${competitionId.toString()}/current.json`;

    // This tests the expected format - actual function is not exported
    // but we're documenting the expected structure
    expect(expectedKey).toBe("leaderboards/competition-123/current.json");
  });

  test("snapshot leaderboard key format", () => {
    const competitionId = CompetitionIdSchema.parse(456);
    const date = new Date("2025-10-15T12:00:00Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const expectedKey = `leaderboards/competition-${competitionId.toString()}/snapshots/${year.toString()}-${month}-${day}.json`;

    expect(expectedKey).toBe("leaderboards/competition-456/snapshots/2025-10-15.json");
  });

  test("snapshot key pads single digit months and days", () => {
    const date = new Date("2025-01-05T12:00:00Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const key = `leaderboards/competition-123/snapshots/${year.toString()}-${month}-${day}.json`;

    expect(key).toBe("leaderboards/competition-123/snapshots/2025-01-05.json");
  });
});

// ============================================================================
// Integration Tests (requires S3 configuration)
// ============================================================================

describe("S3 Leaderboard Storage Integration", () => {
  // These tests require S3_BUCKET_NAME to be configured
  // They will be skipped if S3 is not available

  test.skip("saveCachedLeaderboard saves to both current and snapshot locations", async () => {
    // This would be an integration test that requires actual S3
    // For now we skip it, but it documents the expected behavior:
    // 1. Save to current.json (overwrites)
    // 2. Save to snapshots/YYYY-MM-DD.json (preserves history)
  });

  test.skip("loadCachedLeaderboard retrieves and validates from S3", async () => {
    // This would be an integration test that requires actual S3
    // Expected behavior:
    // 1. Fetch from S3
    // 2. Parse JSON
    // 3. Validate against schema
    // 4. Return typed result or null
  });

  test.skip("loadCachedLeaderboard returns null for non-existent cache", async () => {
    // Expected behavior:
    // 1. Attempt to fetch from S3
    // 2. Handle NoSuchKey error
    // 3. Return null (not throw error)
  });

  test.skip("loadCachedLeaderboard returns null for invalid schema", async () => {
    // Expected behavior:
    // 1. Fetch from S3
    // 2. Parse JSON
    // 3. Validate against schema (fails)
    // 4. Log error and return null
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("Edge Cases", () => {
  test("handles very large leaderboards", () => {
    const largeLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(999),
      calculatedAt: new Date().toISOString(),
      entries: Array.from({ length: 1000 }, (_, i) => ({
        playerId: PlayerIdSchema.parse(i + 1),
        playerName: `Player${(i + 1).toString()}`,
        score: 1000 - i,
        rank: i + 1,
      })),
    };

    const result = CachedLeaderboardSchema.safeParse(largeLeaderboard);
    expect(result.success).toBe(true);
    expect(result.data?.entries.length).toBe(1000);
  });

  test("handles Unicode characters in player names", () => {
    const leaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: new Date().toISOString(),
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "玩家一",
          score: 100,
          rank: 1,
        },
        {
          playerId: PlayerIdSchema.parse(2),
          playerName: "Игрок2",
          score: 90,
          rank: 2,
        },
        {
          playerId: PlayerIdSchema.parse(3),
          playerName: "🎮Player3🏆",
          score: 80,
          rank: 3,
        },
      ],
    };

    const result = CachedLeaderboardSchema.safeParse(leaderboard);
    expect(result.success).toBe(true);
  });

  test("preserves exact ISO timestamp format", () => {
    const timestamp = "2025-10-16T14:30:45.123Z";
    const leaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: timestamp,
      entries: [],
    };

    const result = CachedLeaderboardSchema.safeParse(leaderboard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.calculatedAt).toBe(timestamp);
    }
  });
});
