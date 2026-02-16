import { describe, expect, it } from "bun:test";
import {
  ChampionIdSchema,
  CompetitionIdSchema,
  PlayerIdSchema,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import type { RankedLeaderboardEntry } from "@scout-for-lol/backend/league/competition/leaderboard.ts";
import {
  generateLeaderboardEmbed,
  generateCompetitionDetailsEmbed,
  formatScore,
} from "@scout-for-lol/backend/discord/embeds/competition.ts";

import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a test competition with sensible defaults
 */
function createTestCompetition(overrides: Partial<CompetitionWithCriteria> = {}): CompetitionWithCriteria {
  return {
    id: CompetitionIdSchema.parse(1),
    serverId: testGuildId("12300"),
    ownerId: testAccountId("123"),
    title: "Test Competition",
    description: "A test competition for unit tests",
    channelId: testChannelId("4560"),
    isCancelled: false,
    visibility: "OPEN",
    maxParticipants: 50,
    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: new Date("2025-01-31T23:59:59Z"),
    seasonId: null,
    startProcessedAt: null,
    endProcessedAt: null,
    creatorDiscordId: testAccountId("789"),
    createdTime: new Date("2024-12-01T00:00:00Z"),
    updatedTime: new Date("2024-12-01T00:00:00Z"),
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
    ...overrides,
  };
}

/**
 * Create a test leaderboard entry
 */
function createTestLeaderboardEntry(
  rank: number,
  score: number,
  playerName: string,
  metadata?: Record<string, unknown>,
): RankedLeaderboardEntry {
  const entry: RankedLeaderboardEntry = {
    playerId: PlayerIdSchema.parse(rank),
    playerName,
    score,
    rank,
  };

  // Only add metadata if it's provided
  if (metadata !== undefined) {
    entry.metadata = metadata;
  }

  return entry;
}

// ============================================================================
// Tests: generateLeaderboardEmbed
// ============================================================================

describe("generateLeaderboardEmbed", () => {
  it("should generate embed with correct title and description", () => {
    const competition = createTestCompetition({
      title: "January Grind Challenge",
      description: "Who can play the most games?",
    });
    const leaderboard: RankedLeaderboardEntry[] = [
      createTestLeaderboardEntry(1, 47, "PlayerOne"),
      createTestLeaderboardEntry(2, 45, "ProGamer"),
    ];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    expect(embedData.title).toBe("🏆 January Grind Challenge");
    expect(embedData.description).toBe("Who can play the most games?");
  });

  it("should display top 10 participants when there are more than 10", () => {
    const competition = createTestCompetition();
    const leaderboard: RankedLeaderboardEntry[] = Array.from({ length: 15 }, (_, i) =>
      createTestLeaderboardEntry(i + 1, 100 - i, `Player${(i + 1).toString()}`),
    );

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    // Should have standings field
    const standingsField = embedData.fields?.find((f) => f.name.includes("Standings"));
    expect(standingsField).toBeDefined();
    expect(standingsField?.value).toBeDefined();

    // Should have exactly 10 player entries in the standings (by counting lines)
    const lines = standingsField?.value.split("\n") ?? [];
    expect(lines.length).toBe(10);

    // Should have indicator for more participants
    const indicatorField = embedData.fields?.find((f) => f.value.includes("Showing top 10 of 15"));
    expect(indicatorField).toBeDefined();
  });

  it("should handle ties correctly with same rank number", () => {
    const competition = createTestCompetition({
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "SOLO",
      },
    });

    // Two players tied for rank 2
    const leaderboard: RankedLeaderboardEntry[] = [
      createTestLeaderboardEntry(1, 100, "FirstPlace"),
      createTestLeaderboardEntry(2, 80, "TiedForSecond1"),
      createTestLeaderboardEntry(2, 80, "TiedForSecond2"), // Same rank
      createTestLeaderboardEntry(4, 60, "FourthPlace"), // Next rank is 4, not 3
    ];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    const standingsField = embedData.fields?.find((f) => f.name.includes("Standings"));
    const standingsText = standingsField?.value ?? "";

    // Check that both tied entries have rank 2
    expect(standingsText).toContain("**2.** TiedForSecond1");
    expect(standingsText).toContain("**2.** TiedForSecond2");
    expect(standingsText).toContain("**4.** FourthPlace");
  });

  it("should show medal emojis for top 3", () => {
    const competition = createTestCompetition();
    const leaderboard: RankedLeaderboardEntry[] = [
      createTestLeaderboardEntry(1, 100, "Gold"),
      createTestLeaderboardEntry(2, 90, "Silver"),
      createTestLeaderboardEntry(3, 80, "Bronze"),
      createTestLeaderboardEntry(4, 70, "Fourth"),
    ];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    const standingsField = embedData.fields?.find((f) => f.name.includes("Standings"));
    const standingsText = standingsField?.value ?? "";

    expect(standingsText).toContain("🥇");
    expect(standingsText).toContain("🥈");
    expect(standingsText).toContain("🥉");
  });

  it("should handle empty leaderboard gracefully", () => {
    const competition = createTestCompetition();
    const leaderboard: RankedLeaderboardEntry[] = [];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    const standingsField = embedData.fields?.find((f) => f.name.includes("Standings"));
    expect(standingsField?.value).toContain("No participants have scores yet");
  });

  it("should include criteria description and timestamp in footer", () => {
    const competition = createTestCompetition({
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "SOLO",
      },
    });

    const embed = generateLeaderboardEmbed(competition, []);
    const embedData = embed.toJSON();

    expect(embedData.footer?.text).toContain("Most games played in Solo Queue");
    expect(embedData.footer?.text).toContain("Updated");
  });

  it("should show appropriate standings title for ACTIVE competition", () => {
    const competition = createTestCompetition({
      startDate: new Date(Date.now() - 1000 * 60 * 60 * 24),
      endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 15),
    });

    const leaderboard: RankedLeaderboardEntry[] = [createTestLeaderboardEntry(1, 100, "Player1")];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    const standingsField = embedData.fields?.find((f) => f.name.includes("Current Standings"));
    expect(standingsField).toBeDefined();
  });

  it("should show appropriate standings title for ENDED competition", () => {
    const competition = createTestCompetition({
      startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      endDate: new Date(Date.now() - 1000 * 60 * 60 * 24),
    });

    const leaderboard: RankedLeaderboardEntry[] = [createTestLeaderboardEntry(1, 100, "Player1")];

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const embedData = embed.toJSON();

    const standingsField = embedData.fields?.find((f) => f.name.includes("Final Standings"));
    expect(standingsField).toBeDefined();
  });
});

// ============================================================================
// Tests: generateCompetitionDetailsEmbed
// ============================================================================

describe("generateCompetitionDetailsEmbed", () => {
  it("should include all basic competition metadata", () => {
    const ownerId = testAccountId("12300000123");
    const channelId = testChannelId("456000000");

    const competition = createTestCompetition({
      title: "Test Competition",
      description: "Test description",
      ownerId,
      channelId,
      maxParticipants: 25,
    });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    expect(embedData.title).toBe("🏆 Test Competition");
    expect(embedData.description).toBe("Test description");

    const ownerField = embedData.fields?.find((f) => f.name === "Owner");
    expect(ownerField?.value).toBe(`<@${ownerId}>`);

    const channelField = embedData.fields?.find((f) => f.name === "Channel");
    expect(channelField?.value).toBe(`<#${channelId}>`);

    const maxField = embedData.fields?.find((f) => f.name === "Max Participants");
    expect(maxField?.value).toBe("25");
  });

  it("should show visibility as human-readable text", () => {
    const competition = createTestCompetition({ visibility: "INVITE_ONLY" });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    const visibilityField = embedData.fields?.find((f) => f.name === "Visibility");
    expect(visibilityField?.value).toBe("Invite Only");
  });

  it("should include formatted date range", () => {
    const competition = createTestCompetition({
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: new Date("2025-01-31T23:59:59Z"),
    });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    const durationField = embedData.fields?.find((f) => f.name === "📅 Duration");
    expect(durationField?.value).toContain("Start:");
    expect(durationField?.value).toContain("End:");
  });

  it("should show season ID for season-based competitions", () => {
    const competition = createTestCompetition({
      startDate: null,
      endDate: null,
      seasonId: "2025_SEASON_3_ACT_1",
    });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    const durationField = embedData.fields?.find((f) => f.name === "📅 Duration");
    expect(durationField?.value).toContain("Season-based");
    expect(durationField?.value).toContain("2025_SEASON_3_ACT_1");
  });

  it("should include criteria description", () => {
    const competition = createTestCompetition({
      criteria: {
        type: "HIGHEST_RANK",
        queue: "FLEX",
      },
    });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    const criteriaField = embedData.fields?.find((f) => f.name === "📊 Ranking Criteria");
    expect(criteriaField?.value).toBe("Highest rank in Flex Queue");
  });

  it("should include competition ID in footer", () => {
    const competition = createTestCompetition({ id: CompetitionIdSchema.parse(42) });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    expect(embedData.footer?.text).toBe("Competition ID: 42");
  });

  it("should include created date", () => {
    const competition = createTestCompetition({
      createdTime: new Date("2024-12-15T10:30:00Z"),
    });

    const embed = generateCompetitionDetailsEmbed(competition);
    const embedData = embed.toJSON();

    const createdField = embedData.fields?.find((f) => f.name === "Created");
    expect(createdField?.value).toBeDefined();
    expect(createdField?.value).toContain("Dec");
  });
});

// ============================================================================
// Tests: formatScore (complex cases only)
// ============================================================================

describe("formatScore", () => {
  it("should format rank for HIGHEST_RANK", () => {
    const criteria = {
      type: "HIGHEST_RANK" as const,
      queue: "SOLO" as const,
    };

    const rank = {
      tier: "diamond" as const,
      division: 2 as const,
      lp: 67,
      wins: 100,
      losses: 85,
    };

    const result = formatScore(rank, criteria);
    expect(result).toContain("Diamond");
    expect(result).toContain("67");
  });

  it("should format wins with record when metadata includes games", () => {
    const criteria = {
      type: "MOST_WINS_PLAYER" as const,
      queue: "SOLO" as const,
    };

    const metadata = {
      wins: 12,
      games: 15,
    };

    const result = formatScore(12, criteria, metadata);
    expect(result).toBe("12 wins (12-3, 80%)");
  });

  it("should format wins for MOST_WINS_CHAMPION with record", () => {
    const criteria = {
      type: "MOST_WINS_CHAMPION" as const,
      championId: ChampionIdSchema.parse(157),
      queue: undefined,
    };

    const metadata = {
      wins: 10,
      games: 18,
    };

    const result = formatScore(10, criteria, metadata);
    expect(result).toBe("10 wins (10-8, 56%)");
  });

  it("should format win rate with record when metadata available", () => {
    const criteria = {
      type: "HIGHEST_WIN_RATE" as const,
      queue: "SOLO" as const,
      minGames: 10,
    };

    const metadata = {
      wins: 15,
      games: 20,
    };

    const result = formatScore(75.0, criteria, metadata);
    expect(result).toBe("75.0% (15-5)");
  });

  it("should handle edge case of 100% win rate with record", () => {
    const criteria = {
      type: "HIGHEST_WIN_RATE" as const,
      queue: "SOLO" as const,
      minGames: 10,
    };

    const metadata = {
      wins: 10,
      games: 10,
    };

    const result = formatScore(100.0, criteria, metadata);
    expect(result).toBe("100.0% (10-0)");
  });

  it("should handle edge case of 0% win rate with record", () => {
    const criteria = {
      type: "HIGHEST_WIN_RATE" as const,
      queue: "SOLO" as const,
      minGames: 10,
    };

    const metadata = {
      wins: 0,
      games: 10,
    };

    const result = formatScore(0.0, criteria, metadata);
    expect(result).toBe("0.0% (0-10)");
  });
});
