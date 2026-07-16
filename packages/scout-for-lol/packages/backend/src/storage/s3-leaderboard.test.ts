import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";

import {
  CachedLeaderboardSchema,
  CompetitionIdSchema,
  PlayerIdSchema,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import {
  loadCachedLeaderboard,
  saveCachedLeaderboard,
} from "#src/storage/s3-leaderboard.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const s3Mock = mockClient(S3Client);

// Zod schema for validating PutObjectCommand structure captured by the mock.
const PutLeaderboardCommandSchema = z.object({
  input: z.object({
    Bucket: z.string(),
    Key: z.string(),
    Body: z.string(),
    ContentType: z.string(),
    Metadata: z
      .object({
        competitionId: z.string(),
        version: z.string(),
        calculatedAt: z.string(),
        entryCount: z.string(),
        uploadedAt: z.string(),
      })
      .optional(),
  }),
});

function getValidatedPutCommand(callIndex: number) {
  const call = s3Mock.call(callIndex);
  return PutLeaderboardCommandSchema.parse(call?.args?.[0]);
}

// SdkStream can't be constructed in test code, so return a partial mock and
// feed it through `.callsFake()` (which accepts any return type) rather than
// `.resolves()` (which requires a full GetObjectCommandOutput).
function mockGetObjectBody(content: string) {
  return {
    Body: {
      transformToString: () => Promise.resolve(content),
    },
    $metadata: {},
  };
}

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

    expect(expectedKey).toBe(
      "leaderboards/competition-456/snapshots/2025-10-15.json",
    );
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
// S3 Storage Tests (aws-sdk-client-mock — in-memory, no real S3)
// ============================================================================

describe("S3 Leaderboard Storage", () => {
  beforeEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  afterEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  test("saveCachedLeaderboard saves to both current and snapshot locations", async () => {
    const leaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(123),
      calculatedAt: "2025-10-15T12:00:00.000Z",
      entries: [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Player1",
          score: 100,
          rank: 1,
        },
      ],
    };

    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    await saveCachedLeaderboard(leaderboard);

    // Two PutObject calls: current.json and the dated snapshot.
    expect(s3Mock.calls().length).toBe(2);

    const currentCommand = getValidatedPutCommand(0);
    expect(currentCommand.input.Bucket).toBe("test-bucket");
    expect(currentCommand.input.Key).toBe(
      "leaderboards/competition-123/current.json",
    );
    expect(currentCommand.input.ContentType).toBe("application/json");
    expect(currentCommand.input.Metadata?.competitionId).toBe("123");
    expect(currentCommand.input.Metadata?.version).toBe("v1");
    expect(currentCommand.input.Metadata?.entryCount).toBe("1");

    const snapshotCommand = getValidatedPutCommand(1);
    expect(snapshotCommand.input.Key).toBe(
      "leaderboards/competition-123/snapshots/2025-10-15.json",
    );

    // Both bodies round-trip back to the original leaderboard.
    const parsedBody: unknown = JSON.parse(currentCommand.input.Body);
    expect(CachedLeaderboardSchema.parse(parsedBody)).toEqual(leaderboard);
  });

  test("loadCachedLeaderboard retrieves and validates from S3", async () => {
    const stored: CachedLeaderboard = {
      version: "v1",
      competitionId: CompetitionIdSchema.parse(456),
      calculatedAt: "2025-10-15T12:00:00.000Z",
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

    s3Mock
      .on(GetObjectCommand, {
        Bucket: "test-bucket",
        Key: "leaderboards/competition-456/current.json",
      })
      .callsFake(() => mockGetObjectBody(JSON.stringify(stored)));

    const result = await loadCachedLeaderboard(456);

    expect(result).toEqual(stored);
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(1);
  });

  test("loadCachedLeaderboard returns null for non-existent cache", async () => {
    // AWS SDK surfaces a missing object as a NoSuchKey error.
    const noSuchKey = Object.assign(new Error("The key does not exist"), {
      name: "NoSuchKey",
    });
    s3Mock.on(GetObjectCommand).rejects(noSuchKey);

    const result = await loadCachedLeaderboard(789);

    expect(result).toBeNull();
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(1);
  });

  test("loadCachedLeaderboard returns null for invalid schema", async () => {
    // Valid JSON, but not a CachedLeaderboard shape → validation fails.
    s3Mock
      .on(GetObjectCommand)
      .callsFake(() =>
        mockGetObjectBody(JSON.stringify({ not: "a-leaderboard" })),
      );

    const result = await loadCachedLeaderboard(321);

    expect(result).toBeNull();
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(1);
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
