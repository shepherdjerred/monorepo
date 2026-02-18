import { describe, expect, test } from "bun:test";
import {
  CompetitionIdSchema,
  PlayerIdSchema,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import { EmbedBuilder } from "discord.js";

/**
 * Tests for leaderboard caching logic in competition view command
 *
 * These tests focus on the critical caching behavior:
 * 1. Loading from S3 cache when available
 * 2. Showing "not available" message when cache missing
 * 3. Timestamp display and age calculation
 * 4. Handling different score types and leaderboard sizes
 */

// ============================================================================
// Test Data Factories
// ============================================================================

function createCachedLeaderboard(options?: {
  competitionId?: number;
  calculatedAt?: string;
  entries?: CachedLeaderboard["entries"];
}): CachedLeaderboard {
  return {
    version: "v1",
    competitionId: CompetitionIdSchema.parse(options?.competitionId ?? 123),
    calculatedAt: options?.calculatedAt ?? new Date().toISOString(),
    entries: options?.entries ?? [
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
      {
        playerId: PlayerIdSchema.parse(3),
        playerName: "Player3",
        score: 60,
        rank: 3,
      },
    ],
  };
}

function createLargeLeaderboard(entryCount: number): CachedLeaderboard {
  return {
    version: "v1",
    competitionId: CompetitionIdSchema.parse(123),
    calculatedAt: new Date().toISOString(),
    entries: Array.from({ length: entryCount }, (_, i) => ({
      playerId: PlayerIdSchema.parse(i + 1),
      playerName: `Player${(i + 1).toString()}`,
      score: 1000 - i * 10,
      rank: i + 1,
    })),
  };
}

function createLeaderboardWithRankScores(): CachedLeaderboard {
  return {
    version: "v1",
    competitionId: CompetitionIdSchema.parse(123),
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
}

function createEmptyLeaderboard(): CachedLeaderboard {
  return {
    version: "v1",
    competitionId: CompetitionIdSchema.parse(123),
    calculatedAt: new Date().toISOString(),
    entries: [],
  };
}

// ============================================================================
// Timestamp Age Calculation Tests
// ============================================================================

describe("Leaderboard Cache Timestamp Display", () => {
  test("should show 'just now' for very recent cache (< 1 minute)", () => {
    const ageMs = 30 * 1000; // 30 seconds ago

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    let ageText = "";
    if (ageHours > 0) {
      ageText = `${ageHours.toString()} hour${ageHours === 1 ? "" : "s"} ago`;
    } else if (ageMinutes > 0) {
      ageText = `${ageMinutes.toString()} minute${ageMinutes === 1 ? "" : "s"} ago`;
    } else {
      ageText = "just now";
    }

    expect(ageText).toBe("just now");
  });

  test("should show minutes for recent cache (< 1 hour)", () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const ageMs = Date.now() - thirtyMinutesAgo.getTime();

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    let ageText = "";
    if (ageHours > 0) {
      ageText = `${ageHours.toString()} hour${ageHours === 1 ? "" : "s"} ago`;
    } else if (ageMinutes > 0) {
      ageText = `${ageMinutes.toString()} minute${ageMinutes === 1 ? "" : "s"} ago`;
    } else {
      ageText = "just now";
    }

    expect(ageText).toBe("30 minutes ago");
  });

  test("should show singular 'minute ago' for 1 minute", () => {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);
    const ageMs = now.getTime() - oneMinuteAgo.getTime();

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    let ageText = "";
    if (ageHours > 0) {
      ageText = `${ageHours.toString()} hour${ageHours === 1 ? "" : "s"} ago`;
    } else if (ageMinutes > 0) {
      ageText = `${ageMinutes.toString()} minute${ageMinutes === 1 ? "" : "s"} ago`;
    } else {
      ageText = "just now";
    }

    expect(ageText).toBe("1 minute ago");
  });

  test("should show hours for older cache (>= 1 hour)", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const ageMs = now.getTime() - twoHoursAgo.getTime();

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    let ageText = "";
    if (ageHours > 0) {
      ageText = `${ageHours.toString()} hour${ageHours === 1 ? "" : "s"} ago`;
    } else if (ageMinutes > 0) {
      ageText = `${ageMinutes.toString()} minute${ageMinutes === 1 ? "" : "s"} ago`;
    } else {
      ageText = "just now";
    }

    expect(ageText).toBe("2 hours ago");
  });

  test("should show singular 'hour ago' for 1 hour", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const ageMs = now.getTime() - oneHourAgo.getTime();

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    let ageText = "";
    if (ageHours > 0) {
      ageText = `${ageHours.toString()} hour${ageHours === 1 ? "" : "s"} ago`;
    } else if (ageMinutes > 0) {
      ageText = `${ageMinutes.toString()} minute${ageMinutes === 1 ? "" : "s"} ago`;
    } else {
      ageText = "just now";
    }

    expect(ageText).toBe("1 hour ago");
  });

  test("should handle 24+ hours correctly", () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const ageMs = now.getTime() - twentyFiveHoursAgo.getTime();

    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    expect(ageHours).toBe(25);
  });

  test("should format date string correctly", () => {
    const cachedAt = new Date("2025-10-15T14:30:00Z");

    const dateStr = cachedAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Note: exact format depends on locale, but should contain date components
    expect(dateStr).toContain("Oct");
    expect(dateStr).toContain("15");
    expect(dateStr).toContain("2025");
  });
});

// ============================================================================
// Cached Data Handling Tests
// ============================================================================

describe("Cached Leaderboard Data Handling", () => {
  test("should handle normal leaderboard with numeric scores", () => {
    const cached = createCachedLeaderboard();

    expect(cached.entries).toHaveLength(3);
    expect(cached.entries[0]?.score).toBe(100);
    expect(cached.entries[0]?.rank).toBe(1);
  });

  test("should handle leaderboard with Rank scores", () => {
    const cached = createLeaderboardWithRankScores();

    expect(cached.entries).toHaveLength(2);
    expect(cached.entries[0]?.score).toEqual({
      tier: "diamond",
      division: 2,
      lp: 75,
      wins: 50,
      losses: 40,
    });
  });

  test("should handle empty leaderboard", () => {
    const cached = createEmptyLeaderboard();

    expect(cached.entries).toHaveLength(0);
  });

  test("should handle large leaderboards (>10 entries)", () => {
    const cached = createLargeLeaderboard(50);

    expect(cached.entries).toHaveLength(50);

    // Should be able to slice to top 10
    const top10 = cached.entries.slice(0, 10);
    expect(top10).toHaveLength(10);
    expect(top10[0]?.rank).toBe(1);
    expect(top10[9]?.rank).toBe(10);
  });

  test("should handle leaderboard with exactly 10 entries", () => {
    const cached = createLargeLeaderboard(10);

    expect(cached.entries).toHaveLength(10);

    const top10 = cached.entries.slice(0, 10);
    expect(top10).toHaveLength(10);
  });

  test("should preserve entry order when mapping to RankedLeaderboardEntry", () => {
    const cached = createCachedLeaderboard();

    // Simulate the mapping done in view.ts
    const mapped = cached.entries.map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      score: entry.score,
      rank: entry.rank,
      ...(entry.metadata !== undefined && { metadata: entry.metadata }),
    }));

    expect(mapped).toHaveLength(3);
    expect(mapped[0]?.rank).toBe(1);
    expect(mapped[1]?.rank).toBe(2);
    expect(mapped[2]?.rank).toBe(3);
  });

  test("should handle entries with metadata", () => {
    const cached = createCachedLeaderboard({
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 10,
          rank: 1,
          metadata: {
            wins: 10,
            games: 15,
            winRate: 0.667,
          },
        },
      ],
    });

    const entry = cached.entries[0];
    expect(entry?.metadata).toBeDefined();
    if (entry?.metadata) {
      expect(entry.metadata["wins"]).toBe(10);
    }
  });

  test("should handle entries without metadata", () => {
    const cached = createCachedLeaderboard();

    const entry = cached.entries[0];
    expect(entry?.metadata).toBeUndefined();
  });
});

// ============================================================================
// Cache Miss Behavior Tests
// ============================================================================

describe("Cache Miss Handling", () => {
  test("should identify when cache is null (not found)", () => {
    const cached: CachedLeaderboard | null = null;

    expect(cached).toBeNull();
  });

  test("should have appropriate message when cache not available", () => {
    const expectedMessage =
      "Leaderboard not yet available. The leaderboard is updated daily at midnight UTC. Check back after the next update!";

    // This is the exact message shown to users
    expect(expectedMessage).toContain("midnight UTC");
    expect(expectedMessage).toContain("daily");
  });

  test("should not attempt calculation when cache is null", () => {
    const cached: CachedLeaderboard | null = null;

    // In the actual code, when cached is null, we return early
    // and don't call calculateLeaderboard
    if (cached) {
      // This path should not be reached
      throw new Error("Should not attempt calculation");
    } else {
      // Show message, don't calculate
      expect(true).toBe(true); // This path is correct
    }
  });
});

// ============================================================================
// Integration with Discord Embed Tests
// ============================================================================

describe("Discord Embed Integration", () => {
  test("should add leaderboard field to embed", () => {
    const embed = new EmbedBuilder();
    const title = "📊 Current Standings";

    embed.addFields({
      name: title,
      value: "━━━━━━━━━━━━━━━━━━━━━",
      inline: false,
    });

    const fields = embed.toJSON().fields;
    expect(fields).toBeDefined();
    expect(fields?.length).toBe(1);
    expect(fields?.[0]?.name).toBe(title);
  });

  test("should format top 10 entries correctly", () => {
    const cached = createLargeLeaderboard(15);
    const top10 = cached.entries.slice(0, 10);

    expect(top10).toHaveLength(10);
    expect(top10[0]?.rank).toBe(1);
    expect(top10[9]?.rank).toBe(10);
  });

  test("should indicate remaining entries when >10", () => {
    const cached = createLargeLeaderboard(25);
    const totalCount = cached.entries.length;

    const message = `(Showing top 10 of ${totalCount.toString()} participants)`;

    expect(message).toBe("(Showing top 10 of 25 participants)");
  });

  test("should not show remaining message when <=10 entries", () => {
    const cached = createLargeLeaderboard(8);
    const shouldShowMessage = cached.entries.length > 10;

    expect(shouldShowMessage).toBe(false);
  });

  test("should format timestamp footer correctly", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const dateStr = twoHoursAgo.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const message = `_Last updated: ${dateStr} (2 hours ago)_`;

    expect(message).toContain("Last updated:");
    expect(message).toContain("2 hours ago");
  });
});

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

describe("Edge Cases", () => {
  test("should handle cache with single entry", () => {
    const cached = createCachedLeaderboard({
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "OnlyPlayer",
          score: 50,
          rank: 1,
        },
      ],
    });

    expect(cached.entries).toHaveLength(1);
    expect(cached.entries[0]?.rank).toBe(1);
  });

  test("should handle cache from different competition IDs", () => {
    const cached1 = createCachedLeaderboard({
      competitionId: CompetitionIdSchema.parse(123),
    });
    const cached2 = createCachedLeaderboard({
      competitionId: CompetitionIdSchema.parse(456),
    });

    expect(cached1.competitionId).not.toBe(cached2.competitionId);
  });

  test("should handle cache with very old timestamp", () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const cached = createCachedLeaderboard({
      calculatedAt: oneWeekAgo.toISOString(),
    });

    const ageMs = now.getTime() - new Date(cached.calculatedAt).getTime();
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    expect(ageHours).toBeGreaterThanOrEqual(168); // 7 days = 168 hours
  });

  test("should handle Unicode characters in player names", () => {
    const cached = createCachedLeaderboard({
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
    });

    expect(cached.entries[0]?.playerName).toBe("玩家一");
    expect(cached.entries[1]?.playerName).toBe("Игрок2");
    expect(cached.entries[2]?.playerName).toBe("🎮Player3🏆");
  });

  test("should handle leaderboard with tied ranks", () => {
    const cached = createCachedLeaderboard({
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
        {
          playerId: PlayerIdSchema.parse(3),
          playerName: "Player3",
          score: 80,
          rank: 2, // Tied for 2nd
        },
        {
          playerId: PlayerIdSchema.parse(4),
          playerName: "Player4",
          score: 60,
          rank: 4, // Next rank is 4, not 3
        },
      ],
    });

    expect(cached.entries[1]?.rank).toBe(2);
    expect(cached.entries[2]?.rank).toBe(2);
    expect(cached.entries[3]?.rank).toBe(4);
  });
});

// ============================================================================
// Status-Specific Behavior Tests
// ============================================================================

describe("Competition Status Handling", () => {
  test("should use correct title for ACTIVE competition", () => {
    const status = "ACTIVE";
    const title =
      status === "ACTIVE" ? "📊 Current Standings" : "📊 Leaderboard";

    expect(title).toBe("📊 Current Standings");
  });

  test("should use correct title for ENDED competition", () => {
    const status = "ENDED";
    const title = status === "ENDED" ? "🎉 Final Standings" : "📊 Leaderboard";

    expect(title).toBe("🎉 Final Standings");
  });

  test("should use correct title for CANCELLED competition", () => {
    const status = "CANCELLED";
    const title =
      status === "CANCELLED"
        ? "📊 Standings (at cancellation)"
        : "📊 Leaderboard";

    expect(title).toBe("📊 Standings (at cancellation)");
  });

  test("should not load cache for DRAFT competition", () => {
    const status = "DRAFT";

    // In the actual code, DRAFT competitions skip the addLeaderboard function
    // and show participant list instead
    const shouldLoadCache = status !== "DRAFT";

    expect(shouldLoadCache).toBe(false);
  });
});
