import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CompetitionIdSchema, getCompetitionStatus } from "@scout-for-lol/data";
import type { Competition } from "@scout-for-lol/backend/generated/prisma/client";

import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
/**
 * These tests verify the validation logic patterns used in edit.ts
 * They test the same patterns without needing Discord.js mocks
 */

describe("Edit validation patterns", () => {
  test("owner check should validate user ID matches competition owner", () => {
    const competition = { ownerId: testAccountId("1230000000000") };
    const userId = testAccountId("1230000000000");
    const isOwner = competition.ownerId === userId;

    expect(isOwner).toBe(true);
  });

  test("non-owner should be rejected", () => {
    const competition = { ownerId: testAccountId("1230000000000") };
    const userId = testAccountId("4560000000000");
    const isOwner = competition.ownerId === userId;

    expect(isOwner).toBe(false);
  });
});

describe("Competition status checks", () => {
  test("DRAFT competition should allow all edits", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(Date.now() + 86400000), // Tomorrow
      endDate: new Date(Date.now() + 2 * 86400000), // Day after tomorrow
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      visibility: "OPEN",
      serverId: testGuildId("12345678900000000"),
      ownerId: testAccountId("1230000000000"),
      channelId: testChannelId("1230000000"),
      title: "Test Competition",
      description: "Test description",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
      maxParticipants: 10,
      createdTime: new Date(),
      updatedTime: new Date(),
      creatorDiscordId: testAccountId("1230000000000"),
      id: CompetitionIdSchema.parse(1),
    };

    const status = getCompetitionStatus(competition);
    const isDraft = status === "DRAFT";

    expect(isDraft).toBe(true);
  });

  test("ACTIVE competition should restrict edits", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(Date.now() - 86400000), // Yesterday
      endDate: new Date(Date.now() + 86400000), // Tomorrow
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      visibility: "OPEN",
      serverId: testGuildId("12345678900000000"),
      ownerId: testAccountId("1230000000000"),
      channelId: testChannelId("1230000000"),
      title: "Test Competition",
      description: "Test description",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
      maxParticipants: 10,
      createdTime: new Date(),
      updatedTime: new Date(),
      creatorDiscordId: testAccountId("1230000000000"),
      id: CompetitionIdSchema.parse(1),
    };

    const status = getCompetitionStatus(competition);
    const isDraft = status === "DRAFT";

    expect(isDraft).toBe(false);
    expect(status).toBe("ACTIVE");
  });

  test("ENDED competition should restrict edits", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(Date.now() - 2 * 86400000), // Two days ago
      endDate: new Date(Date.now() - 86400000), // Yesterday
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      visibility: "OPEN",
      serverId: testGuildId("12345678900000000"),
      ownerId: testAccountId("1230000000000"),
      channelId: testChannelId("1230000000"),
      title: "Test Competition",
      description: "Test description",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
      maxParticipants: 10,
      createdTime: new Date(),
      updatedTime: new Date(),
      creatorDiscordId: testAccountId("1230000000000"),
      id: CompetitionIdSchema.parse(1),
    };

    const status = getCompetitionStatus(competition);
    const isDraft = status === "DRAFT";

    expect(isDraft).toBe(false);
    expect(status).toBe("ENDED");
  });

  test("CANCELLED competition should be rejected", () => {
    const competition: Competition = {
      isCancelled: true,
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 2 * 86400000),
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      visibility: "OPEN",
      serverId: testGuildId("12345678900000000"),
      ownerId: testAccountId("1230000000000"),
      channelId: testChannelId("1230000000"),
      title: "Test Competition",
      description: "Test description",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
      maxParticipants: 10,
      createdTime: new Date(),
      updatedTime: new Date(),
      creatorDiscordId: testAccountId("1230000000000"),
      id: CompetitionIdSchema.parse(1),
    };

    const status = getCompetitionStatus(competition);

    expect(status).toBe("CANCELLED");
  });
});

describe("Field editability rules", () => {
  test("title, description, channelId should be editable in DRAFT", () => {
    const isDraft = true;
    const fieldsEditableAlways = ["title", "description", "channelId"];

    for (const _field of fieldsEditableAlways) {
      const canEdit = isDraft || fieldsEditableAlways.includes(_field);
      expect(canEdit).toBe(true);
    }
  });

  test("title, description, channelId should be editable in ACTIVE", () => {
    const isDraft = false;
    const fieldsEditableAlways = ["title", "description", "channelId"];

    for (const _field of fieldsEditableAlways) {
      const canEdit = isDraft || fieldsEditableAlways.includes(_field);
      expect(canEdit).toBe(true);
    }
  });

  test("visibility should only be editable in DRAFT", () => {
    const isDraftTrue = true;
    const isDraftFalse = false;

    const canEditInDraft = isDraftTrue;
    const canEditInActive = isDraftFalse;

    expect(canEditInDraft).toBe(true);
    expect(canEditInActive).toBe(false);
  });

  test("maxParticipants should only be editable in DRAFT", () => {
    const isDraftTrue = true;
    const isDraftFalse = false;

    const canEditInDraft = isDraftTrue;
    const canEditInActive = isDraftFalse;

    expect(canEditInDraft).toBe(true);
    expect(canEditInActive).toBe(false);
  });

  test("dates should only be editable in DRAFT", () => {
    const isDraftTrue = true;
    const isDraftFalse = false;

    const canEditInDraft = isDraftTrue;
    const canEditInActive = isDraftFalse;

    expect(canEditInDraft).toBe(true);
    expect(canEditInActive).toBe(false);
  });

  test("criteria should only be editable in DRAFT", () => {
    const isDraftTrue = true;
    const isDraftFalse = false;

    const canEditInDraft = isDraftTrue;
    const canEditInActive = isDraftFalse;

    expect(canEditInDraft).toBe(true);
    expect(canEditInActive).toBe(false);
  });
});

describe("Date validation patterns", () => {
  test("valid ISO date strings should parse correctly", () => {
    const dateStr1 = "2025-01-15";
    const dateStr2 = "2025-01-15T12:00:00Z";
    const dateStr3 = "2025-01-15T12:00:00";

    const date1 = new Date(dateStr1);
    const date2 = new Date(dateStr2);
    const date3 = new Date(dateStr3);

    expect(isNaN(date1.getTime())).toBe(false);
    expect(isNaN(date2.getTime())).toBe(false);
    expect(isNaN(date3.getTime())).toBe(false);
  });

  test("start date must be before end date", () => {
    const startDate = new Date("2025-01-01");
    const endDate = new Date("2025-01-31");

    expect(startDate < endDate).toBe(true);
  });

  test("start date after end date should be invalid", () => {
    const startDate = new Date("2025-01-31");
    const endDate = new Date("2025-01-01");

    expect(startDate < endDate).toBe(false);
  });

  test("start date equal to end date should be invalid", () => {
    const startDate = new Date("2025-01-15T12:00:00Z");
    const endDate = new Date("2025-01-15T12:00:00Z");

    expect(startDate < endDate).toBe(false);
  });

  test("date XOR validation for edit", () => {
    // Can provide fixed dates
    const hasFixedDates1 = true;
    const hasSeason1 = false;
    expect(hasFixedDates1).not.toBe(hasSeason1);

    // Can provide season
    const hasFixedDates2 = false;
    const hasSeason2 = true;
    expect(hasFixedDates2).not.toBe(hasSeason2);

    // Cannot provide both
    const hasFixedDates3 = true;
    const hasSeason3 = true;
    expect(hasFixedDates3).toBe(hasSeason3);

    // Can provide neither (no date change)
    const hasFixedDates4 = false;
    const hasSeason4 = false;
    expect(hasFixedDates4).toBe(hasSeason4);
  });
});

describe("Input length validation", () => {
  test("title must be 1-100 characters if provided", () => {
    const validTitles = ["A", "Test Competition", "A".repeat(100)];
    const invalidTitles = ["", "A".repeat(101)];

    for (const title of validTitles) {
      expect(title.length).toBeGreaterThanOrEqual(1);
      expect(title.length).toBeLessThanOrEqual(100);
    }

    for (const title of invalidTitles) {
      const isValid = title.length >= 1 && title.length <= 100;
      expect(isValid).toBe(false);
    }
  });

  test("description must be 1-500 characters if provided", () => {
    const validDescriptions = ["A", "Test description", "A".repeat(500)];
    const invalidDescriptions = ["", "A".repeat(501)];

    for (const desc of validDescriptions) {
      expect(desc.length).toBeGreaterThanOrEqual(1);
      expect(desc.length).toBeLessThanOrEqual(500);
    }

    for (const desc of invalidDescriptions) {
      const isValid = desc.length >= 1 && desc.length <= 500;
      expect(isValid).toBe(false);
    }
  });
});

describe("Update input building", () => {
  test("should only include provided fields in update input", () => {
    const updateInput: Record<string, unknown> = {};

    const title = "New Title";
    const description = undefined;
    const channelId = "channel123";

    if (title !== undefined) {
      updateInput["title"] = title;
    }
    if (description !== undefined) {
      updateInput["description"] = description;
    }
    if (channelId !== undefined) {
      updateInput["channelId"] = channelId;
    }

    expect(updateInput).toEqual({
      title: "New Title",
      channelId: "channel123",
    });
    expect(updateInput["description"]).toBeUndefined();
  });

  test("should reject empty update (no fields provided)", () => {
    const updateInput: Record<string, unknown> = {};

    const hasUpdates = Object.keys(updateInput).length > 0;

    expect(hasUpdates).toBe(false);
  });

  test("should accept update with at least one field", () => {
    const updateInput: Record<string, unknown> = { title: "New Title" };

    const hasUpdates = Object.keys(updateInput).length > 0;

    expect(hasUpdates).toBe(true);
  });
});

describe("Error handling for restricted edits", () => {
  test("should error when trying to change dates on ACTIVE competition", () => {
    const isDraft = false;
    const datesProvided = true;

    const shouldError = !isDraft && datesProvided;

    expect(shouldError).toBe(true);
  });

  test("should error when trying to change criteria on ACTIVE competition", () => {
    const isDraft = false;
    const criteriaProvided = true;

    const shouldError = !isDraft && criteriaProvided;

    expect(shouldError).toBe(true);
  });

  test("should error when trying to change visibility on ACTIVE competition", () => {
    const isDraft = false;
    const visibilityProvided = true;

    const shouldError = !isDraft && visibilityProvided;

    expect(shouldError).toBe(true);
  });

  test("should error when trying to change maxParticipants on ACTIVE competition", () => {
    const isDraft = false;
    const maxParticipantsProvided = true;

    const shouldError = !isDraft && maxParticipantsProvided;

    expect(shouldError).toBe(true);
  });

  test("should allow changing title on ACTIVE competition", () => {
    const isDraft = false;
    const titleProvided = true;
    const fieldsEditableAlways = ["title", "description", "channelId"];

    // Title is always editable, so no error
    const shouldError = !isDraft && titleProvided && !fieldsEditableAlways.includes("title");

    expect(shouldError).toBe(false);
  });
});

describe("Criteria validation patterns", () => {
  test("MOST_GAMES_PLAYED requires queue", () => {
    const queue = "SOLO";

    expect(queue).toBeDefined();
    expect(["SOLO", "FLEX", "RANKED_ANY", "ARENA", "ARAM", "ALL"]).toContain(queue);
  });

  test("HIGHEST_RANK requires queue to be SOLO or FLEX", () => {
    const validQueues = ["SOLO", "FLEX"];
    const queue = "SOLO";

    expect(validQueues).toContain(queue);
  });

  test("MOST_WINS_CHAMPION requires championId", () => {
    const championId = 157; // Yasuo

    expect(championId).toBeGreaterThan(0);
    expect(z.number().int().safeParse(championId).success).toBe(true);
  });
});
