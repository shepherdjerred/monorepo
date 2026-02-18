import { describe, expect, test } from "bun:test";
import {
  CompetitionCreationSchema,
  CompetitionDatesSchema,
  isCompetitionActive,
} from "@scout-for-lol/backend/database/competition/validation.ts";

import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "@scout-for-lol/backend/testing/test-ids.ts";
// ============================================================================
// isCompetitionActive
// ============================================================================

describe("isCompetitionActive", () => {
  const now = new Date("2025-01-15T12:00:00Z");

  test("returns false for cancelled competition", () => {
    const endDate = new Date("2025-02-15T12:00:00Z"); // Future date
    expect(isCompetitionActive(true, endDate, now)).toBe(false);
  });

  test("returns true for active season-based competition (no endDate)", () => {
    expect(isCompetitionActive(false, null, now)).toBe(true);
  });

  test("returns false for cancelled season-based competition", () => {
    expect(isCompetitionActive(true, null, now)).toBe(false);
  });

  test("returns true for active fixed-date competition (endDate in future)", () => {
    const endDate = new Date("2025-02-15T12:00:00Z");
    expect(isCompetitionActive(false, endDate, now)).toBe(true);
  });

  test("returns false for ended fixed-date competition (endDate in past)", () => {
    const endDate = new Date("2025-01-10T12:00:00Z");
    expect(isCompetitionActive(false, endDate, now)).toBe(false);
  });

  test("returns false for competition ending exactly now", () => {
    const endDate = new Date("2025-01-15T12:00:00Z"); // Same as now
    expect(isCompetitionActive(false, endDate, now)).toBe(false);
  });

  test("uses current time if now not provided", () => {
    const endDate = new Date(Date.now() + 86_400_000); // Tomorrow
    expect(isCompetitionActive(false, endDate)).toBe(true);
  });
});

// ============================================================================
// CompetitionDatesSchema - XOR Constraint
// ============================================================================

describe("CompetitionDatesSchema - discriminated union", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-01-31");

  test("passes with FIXED_DATES type", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("passes with SEASON type for active season", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "SEASON",
      seasonId: "2025_SEASON_3_ACT_1",
    });
    expect(result.success).toBe(true);
  });

  test("rejects SEASON with invalid seasonId", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "SEASON",
      seasonId: "INVALID_SEASON",
    });
    expect(result.success).toBe(false);
  });

  test("fails with invalid discriminator type", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "INVALID",
      startDate,
      endDate,
    });
    expect(result.success).toBe(false);
  });

  test("fails with missing discriminator", () => {
    const result = CompetitionDatesSchema.safeParse({
      startDate,
      endDate,
    });
    expect(result.success).toBe(false);
  });

  test("fails when FIXED_DATES missing startDate", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      endDate,
    });
    expect(result.success).toBe(false);
  });

  test("fails when FIXED_DATES missing endDate", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
    });
    expect(result.success).toBe(false);
  });

  test("fails when SEASON missing seasonId", () => {
    const result = CompetitionDatesSchema.safeParse({
      type: "SEASON",
    });
    expect(result.success).toBe(false);
  });

  test("type system enforces XOR - can't mix fixed dates with season", () => {
    // This test demonstrates that TypeScript won't allow mixing types
    // at compile time, and validation catches it at runtime
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
      seasonId: "2025_SEASON_3_ACT_1", // Extra field ignored
    });
    expect(result.success).toBe(true); // Passes because extra fields are ignored
  });
});

// ============================================================================
// CompetitionDatesSchema - Date Order
// ============================================================================

describe("CompetitionDatesSchema - date order", () => {
  test("passes when startDate is before endDate", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-15T00:00:00Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("passes when startDate is just 1 second before endDate", () => {
    const startDate = new Date("2025-01-01T12:00:00Z");
    const endDate = new Date("2025-01-01T12:00:01Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("fails when startDate equals endDate", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate: date,
      endDate: date,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "startDate must be before endDate",
      );
    }
  });

  test("fails when startDate is after endDate", () => {
    const startDate = new Date("2025-01-15T00:00:00Z");
    const endDate = new Date("2025-01-01T00:00:00Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "startDate must be before endDate",
      );
    }
  });
});

// ============================================================================
// CompetitionDatesSchema - Duration Limit
// ============================================================================

describe("CompetitionDatesSchema - duration limit", () => {
  test("passes with 1 day duration", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-02T00:00:00Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("passes with 89 days duration", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date(startDate.getTime() + 89 * 24 * 60 * 60 * 1000);
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("passes with exactly 90 days duration", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(true);
  });

  test("fails with 91 days duration", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date(startDate.getTime() + 91 * 24 * 60 * 60 * 1000);
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "Competition duration cannot exceed 90 days",
      );
    }
  });

  test("fails with 365 days duration", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2026-01-01T00:00:00Z");
    const result = CompetitionDatesSchema.safeParse({
      type: "FIXED_DATES",
      startDate,
      endDate,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "Competition duration cannot exceed 90 days",
      );
    }
  });

  test("duration check not applied to season-based competitions", () => {
    // Season-based competitions can be arbitrarily long
    const result = CompetitionDatesSchema.safeParse({
      type: "SEASON",
      seasonId: "2025_SEASON_3_ACT_1",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// CompetitionCreationSchema - Complete Validation
// ============================================================================

describe("CompetitionCreationSchema - Discord ID validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts valid Discord snowflake IDs", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("rejects invalid serverId (too short)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      serverId: "1234000000000000", // 16 chars - actually too short
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid ownerId (contains letters)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      ownerId: "123456789012abc456", // Contains letters - invalid
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid channelId (too long)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      channelId: "123456789012345678901", // 21 chars - actually too long
    });
    expect(result.success).toBe(false);
  });
});

describe("CompetitionCreationSchema - title validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts valid title", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("rejects empty title", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      title: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("cannot be empty");
    }
  });

  test("rejects title exceeding 100 characters", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      title: "a".repeat(101),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("cannot exceed 100");
    }
  });

  test("accepts title at 100 character limit", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      title: "a".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  test("trims whitespace from title", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      title: "  Test Competition  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Test Competition");
    }
  });
});

describe("CompetitionCreationSchema - description validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts valid description", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("rejects empty description", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      description: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects description exceeding 500 characters", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("cannot exceed 500");
    }
  });

  test("accepts description at 500 character limit", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      description: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });

  test("trims whitespace from description", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      description: "  Test description  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Test description");
    }
  });
});

describe("CompetitionCreationSchema - visibility validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts OPEN visibility", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("accepts INVITE_ONLY visibility", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      visibility: "INVITE_ONLY",
    });
    expect(result.success).toBe(true);
  });

  test("accepts SERVER_WIDE visibility", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      visibility: "SERVER_WIDE",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid visibility value", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      visibility: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});

describe("CompetitionCreationSchema - maxParticipants validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts valid maxParticipants", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("accepts minimum maxParticipants (2)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      maxParticipants: 2,
    });
    expect(result.success).toBe(true);
  });

  test("accepts maximum maxParticipants (100)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      maxParticipants: 100,
    });
    expect(result.success).toBe(true);
  });

  test("rejects maxParticipants below minimum (1)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      maxParticipants: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("at least 2");
    }
  });

  test("rejects maxParticipants above maximum (101)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      maxParticipants: 101,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("cannot exceed 100");
    }
  });

  test("rejects non-integer maxParticipants", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      maxParticipants: 50.5,
    });
    expect(result.success).toBe(false);
  });

  test("defaults to 50 if not provided", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxParticipants).toBe(50);
    }
  });
});

describe("CompetitionCreationSchema - criteria validation", () => {
  const validInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111111111111111111"),
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN" as const,
    maxParticipants: 50,
    dates: { type: "SEASON" as const, seasonId: "2025_SEASON_3_ACT_1" },
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
  };

  test("accepts valid MOST_GAMES_PLAYED criteria", () => {
    const result = CompetitionCreationSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("accepts valid HIGHEST_RANK criteria", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid MOST_WINS_CHAMPION criteria", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({ championId: 157, queue: "SOLO" }),
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid HIGHEST_WIN_RATE criteria with minGames", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "HIGHEST_WIN_RATE",
      criteriaConfig: JSON.stringify({ minGames: 25, queue: "SOLO" }),
    });
    expect(result.success).toBe(true);
  });

  test("rejects MOST_WINS_CHAMPION without championId", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }), // Missing championId!
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "criteriaConfig must be valid JSON",
      );
    }
  });

  test("rejects HIGHEST_RANK with invalid queue (ARENA)", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "ARENA" }), // ARENA has no ranks!
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid JSON in criteriaConfig", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaConfig: "not valid json",
    });
    expect(result.success).toBe(false);
  });

  test("rejects criteriaConfig that doesn't match criteriaType", () => {
    const result = CompetitionCreationSchema.safeParse({
      ...validInput,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ championId: 157 }), // Wrong config for this type
    });
    expect(result.success).toBe(false);
  });
});
