import { describe, expect, test } from "bun:test";
import type { RawMatch } from "@scout-for-lol/data";

// We'll need to test internal helper functions, so let's create a test version
// that exposes these functions for testing

/**
 * Generate date prefixes for S3 listing between start and end dates (inclusive)
 * Returns paths in format: matches/YYYY/MM/DD/
 */
function generateDatePrefixes(startDate: Date, endDate: Date): string[] {
  const prefixes: string[] = [];
  const current = new Date(startDate);

  // Normalize to start of day in UTC
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, "0");
    const day = String(current.getUTCDate()).padStart(2, "0");

    prefixes.push(`matches/${year.toString()}/${month}/${day}/`);

    // Move to next day
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return prefixes;
}

/**
 * Check if a match includes any of the specified participant PUUIDs
 */
function matchIncludesParticipant(match: RawMatch, puuids: string[]): boolean {
  return match.metadata.participants.some((puuid: string) => puuids.includes(puuid));
}

// ============================================================================
// generateDatePrefixes Tests
// ============================================================================

describe("generateDatePrefixes", () => {
  test("generates single day path for same start and end date", () => {
    const startDate = new Date("2025-01-15T00:00:00Z");
    const endDate = new Date("2025-01-15T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/01/15/"]);
  });

  test("generates three day paths for date range spanning 3 days", () => {
    const startDate = new Date("2025-01-15T00:00:00Z");
    const endDate = new Date("2025-01-17T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/01/15/", "matches/2025/01/16/", "matches/2025/01/17/"]);
  });

  test("handles month boundary crossing", () => {
    const startDate = new Date("2025-01-31T00:00:00Z");
    const endDate = new Date("2025-02-02T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/01/31/", "matches/2025/02/01/", "matches/2025/02/02/"]);
  });

  test("handles year boundary crossing", () => {
    const startDate = new Date("2024-12-30T00:00:00Z");
    const endDate = new Date("2025-01-02T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual([
      "matches/2024/12/30/",
      "matches/2024/12/31/",
      "matches/2025/01/01/",
      "matches/2025/01/02/",
    ]);
  });

  test("pads single-digit months and days with zeros", () => {
    const startDate = new Date("2025-01-05T00:00:00Z");
    const endDate = new Date("2025-01-07T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/01/05/", "matches/2025/01/06/", "matches/2025/01/07/"]);
  });

  test("handles dates with different times on same day", () => {
    const startDate = new Date("2025-01-15T08:30:00Z");
    const endDate = new Date("2025-01-15T18:45:00Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/01/15/"]);
  });

  test("handles leap year February", () => {
    const startDate = new Date("2024-02-28T00:00:00Z");
    const endDate = new Date("2024-03-01T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2024/02/28/", "matches/2024/02/29/", "matches/2024/03/01/"]);
  });

  test("handles non-leap year February", () => {
    const startDate = new Date("2025-02-28T00:00:00Z");
    const endDate = new Date("2025-03-01T23:59:59Z");

    const prefixes = generateDatePrefixes(startDate, endDate);

    expect(prefixes).toEqual(["matches/2025/02/28/", "matches/2025/03/01/"]);
  });
});

// ============================================================================
// matchIncludesParticipant Tests
// ============================================================================

describe("matchIncludesParticipant", () => {
  // Create a mock match factory
  function createMockMatch(participantPuuids: string[]): RawMatch {
    return {
      metadata: {
        dataVersion: "2",
        matchId: "TEST_MATCH",
        participants: participantPuuids,
      },
      info: {
        endOfGameResult: "GameComplete",
        gameCreation: 1000000,
        gameDuration: 1800,
        gameEndTimestamp: 2000000,
        gameId: 123456789,
        gameMode: "CLASSIC",
        gameName: "teambuilder-match-123",
        gameStartTimestamp: 1000000,
        gameType: "MATCHED_GAME",
        gameVersion: "14.1.1",
        mapId: 11,
        participants: [],
        platformId: "NA1",
        queueId: 420,
        teams: [],
        tournamentCode: "",
      },
    };
  }

  test("includes match when participant PUUID is in list", () => {
    const match = createMockMatch(["PUUID-1", "PUUID-2", "PUUID-3"]);
    const puuids = ["PUUID-2"];

    expect(matchIncludesParticipant(match, puuids)).toBe(true);
  });

  test("excludes match when no participants are in list", () => {
    const match = createMockMatch(["PUUID-1", "PUUID-2", "PUUID-3"]);
    const puuids = ["PUUID-4", "PUUID-5"];

    expect(matchIncludesParticipant(match, puuids)).toBe(false);
  });

  test("includes match when multiple participants are in list", () => {
    const match = createMockMatch(["PUUID-1", "PUUID-2", "PUUID-3"]);
    const puuids = ["PUUID-1", "PUUID-2"];

    expect(matchIncludesParticipant(match, puuids)).toBe(true);
  });

  test("handles empty PUUID list", () => {
    const match = createMockMatch(["PUUID-1", "PUUID-2"]);
    const puuids: string[] = [];

    expect(matchIncludesParticipant(match, puuids)).toBe(false);
  });

  test("handles empty participants list in match", () => {
    const match = createMockMatch([]);
    const puuids = ["PUUID-1"];

    expect(matchIncludesParticipant(match, puuids)).toBe(false);
  });

  test("matches are case-sensitive", () => {
    const match = createMockMatch(["PUUID-1-lowercase"]);
    const puuids = ["PUUID-1-UPPERCASE"];

    expect(matchIncludesParticipant(match, puuids)).toBe(false);
  });

  test("includes match with only first participant matching", () => {
    const match = createMockMatch(["PUUID-MATCH", "PUUID-NO-MATCH-1", "PUUID-NO-MATCH-2"]);
    const puuids = ["PUUID-MATCH"];

    expect(matchIncludesParticipant(match, puuids)).toBe(true);
  });

  test("includes match with only last participant matching", () => {
    const match = createMockMatch(["PUUID-NO-MATCH-1", "PUUID-NO-MATCH-2", "PUUID-MATCH"]);
    const puuids = ["PUUID-MATCH"];

    expect(matchIncludesParticipant(match, puuids)).toBe(true);
  });
});
