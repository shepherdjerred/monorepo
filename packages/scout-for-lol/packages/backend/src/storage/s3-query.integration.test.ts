/**
 * S3 Query Integration Tests using aws-sdk-client-mock
 *
 * These tests use in-memory mocking via aws-sdk-client-mock instead of real S3.
 * This makes them fast, reliable, and doesn't require AWS credentials.
 *
 * Environment setup is handled automatically by test-setup.ts (preloaded via bunfig.toml)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { RawMatch } from "@scout-for-lol/data";
import { queryMatchesByDateRange } from "@scout-for-lol/backend/storage/s3-query.ts";

// Create S3 mock
const s3Mock = mockClient(S3Client);

// Helper to create a mock match
function createMockMatch(matchId: string, participantPuuids: string[], gameCreationDate: Date): RawMatch {
  return {
    metadata: {
      dataVersion: "2",
      matchId: matchId,
      participants: participantPuuids,
    },
    info: {
      endOfGameResult: "GameComplete",
      gameCreation: gameCreationDate.getTime(),
      gameDuration: 1800,
      gameEndTimestamp: gameCreationDate.getTime() + 1800000,
      gameId: Number.parseInt(matchId.replace("TEST_", "")),
      gameMode: "CLASSIC",
      gameName: `teambuilder-match-${matchId}`,
      gameStartTimestamp: gameCreationDate.getTime(),
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

// Helper to generate S3 key for a match on a specific date
function generateMatchKey(matchId: string, date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
}

// Helper to create a mock GetObjectCommandOutput
// We need to mock the AWS SDK response for testing
type MockBody = {
  transformToString(): Promise<string>;
  locked: boolean;
  cancel(): Promise<void>;
  getReader(): { read(): Promise<{ done: boolean; value?: unknown }> };
  pipeThrough(): { readable: unknown; writable: unknown };
  pipeTo(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
};

function createMockGetObjectResponse(content: string): GetObjectCommandOutput {
  const mockBody: MockBody = {
    transformToString: () => Promise.resolve(content),
    locked: false,
    cancel: () => Promise.resolve(),
    getReader: () => ({
      read: () => Promise.resolve({ done: true, value: undefined }),
    }),
    pipeThrough: () => ({ readable: undefined, writable: undefined }),
    pipeTo: () => Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      // Empty async generator
      yield* [];
    },
  };

  // Create a response object that matches GetObjectCommandOutput structure
  // The mock body implements transformToString() which is what's actually used
  // TypeScript can't verify the full structural match, but the mock works at runtime
  // eslint-disable-next-line custom-rules/no-type-assertions -- ok for now
  return {
    Body: mockBody,
    $metadata: {},
  } as unknown as GetObjectCommandOutput;
}

beforeEach(() => {
  // Reset mock before each test
  s3Mock.reset();
});

afterEach(() => {
  // Reset mock after each test
  s3Mock.reset();
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("queryMatchesByDateRange - single day", () => {
  test("returns matches from a single day", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid1 = "PUUID-TEST-1";
    const puuid2 = "PUUID-TEST-2";

    // Create mock matches
    const match1 = createMockMatch("TEST_1001", [puuid1, "PUUID-OTHER-1"], date);
    const match2 = createMockMatch("TEST_1002", [puuid2, "PUUID-OTHER-2"], date);
    const match3 = createMockMatch("TEST_1003", [puuid1, puuid2], date);

    const prefix = "games/2025/01/15/";

    // Mock S3 ListObjectsV2
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        { Key: generateMatchKey("TEST_1001", date) },
        { Key: generateMatchKey("TEST_1002", date) },
        { Key: generateMatchKey("TEST_1003", date) },
      ],
    });

    // Mock S3 GetObject for each match
    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_1001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_1002", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_1003", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    // Query for matches with puuid1 or puuid2
    const results = await queryMatchesByDateRange(date, date, [puuid1, puuid2]);

    expect(results.length).toBe(3);
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_1001", "TEST_1002", "TEST_1003"]);
  });

  test("filters matches by participant PUUID", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const targetPuuid = "PUUID-TARGET";
    const otherPuuid = "PUUID-OTHER";

    // Create mock matches: 2 with targetPuuid, 1 without
    const match1 = createMockMatch("TEST_2001", [targetPuuid, otherPuuid], date);
    const match2 = createMockMatch("TEST_2002", [otherPuuid, "PUUID-ANOTHER"], date);
    const match3 = createMockMatch("TEST_2003", [targetPuuid, "PUUID-ANOTHER"], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        { Key: generateMatchKey("TEST_2001", date) },
        { Key: generateMatchKey("TEST_2002", date) },
        { Key: generateMatchKey("TEST_2003", date) },
      ],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_2001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_2002", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_2003", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    // Query for matches with targetPuuid only
    const results = await queryMatchesByDateRange(date, date, [targetPuuid]);

    expect(results.length).toBe(2);
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_2001", "TEST_2003"]);
  });

  test("returns empty array when no matches found", async () => {
    const date = new Date("2025-01-20T12:00:00Z");
    const puuid = "PUUID-NONEXISTENT";

    const prefix = "games/2025/01/20/";

    // Mock empty S3 response
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [],
    });

    const results = await queryMatchesByDateRange(date, date, [puuid]);

    expect(results).toEqual([]);
  });
});

describe("queryMatchesByDateRange - date range", () => {
  test("returns matches across multiple days", async () => {
    const puuid = "PUUID-MULTIDAY";

    const date1 = new Date("2025-01-15T12:00:00Z");
    const date2 = new Date("2025-01-16T12:00:00Z");
    const date3 = new Date("2025-01-17T12:00:00Z");

    // Create matches on 3 consecutive days
    const match1 = createMockMatch("TEST_3001", [puuid, "OTHER-1"], date1);
    const match2 = createMockMatch("TEST_3002", [puuid, "OTHER-2"], date2);
    const match3 = createMockMatch("TEST_3003", [puuid, "OTHER-3"], date3);

    // Mock S3 responses for each day
    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/15/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_3001", date1) }],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/16/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_3002", date2) }],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/17/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_3003", date3) }],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_3001", date1) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_3002", date2) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_3003", date3) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    // Query the entire range
    const results = await queryMatchesByDateRange(date1, date3, [puuid]);

    expect(results.length).toBe(3);
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_3001", "TEST_3002", "TEST_3003"]);
  });

  test("handles partial date ranges", async () => {
    const puuid = "PUUID-PARTIAL";

    const date2 = new Date("2025-01-16T12:00:00Z");
    const date3 = new Date("2025-01-17T12:00:00Z");

    // Create matches on 2 days (we query only date2 to date3)
    const match2 = createMockMatch("TEST_4002", [puuid], date2);
    const match3 = createMockMatch("TEST_4003", [puuid], date3);

    // Mock S3 responses - only for days 2 and 3 (we're querying date2 to date3)
    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/16/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_4002", date2) }],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/17/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_4003", date3) }],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_4002", date2) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_4003", date3) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    // Query only middle 2 days
    const results = await queryMatchesByDateRange(date2, date3, [puuid]);

    expect(results.length).toBe(2);
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_4002", "TEST_4003"]);
  });

  test("handles month boundary crossing", async () => {
    const puuid = "PUUID-MONTH-CROSS";

    const date1 = new Date("2025-01-31T12:00:00Z");
    const date2 = new Date("2025-02-01T12:00:00Z");
    const date3 = new Date("2025-02-02T12:00:00Z");

    const match1 = createMockMatch("TEST_5001", [puuid], date1);
    const match2 = createMockMatch("TEST_5002", [puuid], date2);
    const match3 = createMockMatch("TEST_5003", [puuid], date3);

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/31/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_5001", date1) }],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/02/01/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_5002", date2) }],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/02/02/" }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_5003", date3) }],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_5001", date1) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_5002", date2) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_5003", date3) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    const results = await queryMatchesByDateRange(date1, date3, [puuid]);

    expect(results.length).toBe(3);
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_5001", "TEST_5002", "TEST_5003"]);
  });
});

describe("queryMatchesByDateRange - edge cases", () => {
  test("returns empty array when PUUIDs array is empty", async () => {
    const date = new Date("2025-01-15T12:00:00Z");

    const results = await queryMatchesByDateRange(date, date, []);

    expect(results).toEqual([]);
  });

  test("handles invalid JSON in S3 gracefully", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-INVALID-JSON";

    // Valid match
    const validMatch = createMockMatch("TEST_6001", [puuid], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_6001", date) }, { Key: generateMatchKey("TEST_6002_INVALID", date) }],
    });

    // Valid match returns proper JSON
    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_6001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(validMatch)));

    // Invalid match returns malformed JSON
    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_6002_INVALID", date) })
      .resolves(createMockGetObjectResponse("{ invalid json content"));

    // Query should skip invalid JSON and return valid match
    const results = await queryMatchesByDateRange(date, date, [puuid]);

    expect(results.length).toBe(1);
    expect(results[0]?.metadata.matchId).toBe("TEST_6001");
  });

  test("handles multiple participants correctly", async () => {
    const date = new Date("2025-01-15T12:00:00Z");

    const puuid1 = "PUUID-PLAYER-1";
    const puuid2 = "PUUID-PLAYER-2";
    const puuid3 = "PUUID-PLAYER-3";

    // Match with puuid1 and puuid2
    const match1 = createMockMatch("TEST_7001", [puuid1, puuid2, "OTHER-1"], date);
    // Match with puuid2 and puuid3
    const match2 = createMockMatch("TEST_7002", [puuid2, puuid3, "OTHER-2"], date);
    // Match with puuid1 only
    const match3 = createMockMatch("TEST_7003", [puuid1, "OTHER-3", "OTHER-4"], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        { Key: generateMatchKey("TEST_7001", date) },
        { Key: generateMatchKey("TEST_7002", date) },
        { Key: generateMatchKey("TEST_7003", date) },
      ],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_7001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_7002", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_7003", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match3)));

    // Query for puuid1 and puuid2
    const results = await queryMatchesByDateRange(date, date, [puuid1, puuid2]);

    expect(results.length).toBe(3); // All matches contain at least one of the PUUIDs
    expect(results.map((m) => m.metadata.matchId).sort()).toEqual(["TEST_7001", "TEST_7002", "TEST_7003"]);
  });

  test("handles S3 GetObject errors gracefully", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-ERROR-TEST";

    const validMatch = createMockMatch("TEST_8001", [puuid], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_8001", date) }, { Key: generateMatchKey("TEST_8002_ERROR", date) }],
    });

    // First match returns successfully
    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_8001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(validMatch)));

    // Second match throws error
    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_8002_ERROR", date) })
      .rejects(new Error("S3 GetObject failed"));

    // Query should handle error and return valid match
    const results = await queryMatchesByDateRange(date, date, [puuid]);

    expect(results.length).toBe(1);
    expect(results[0]?.metadata.matchId).toBe("TEST_8001");
  });
});

describe("queryMatchesByDateRange - S3 configuration", () => {
  test("returns empty array when PUUIDs array is empty", async () => {
    // This tests the early return for empty PUUIDs
    const date = new Date("2025-01-15T12:00:00Z");

    const results = await queryMatchesByDateRange(date, date, []);

    expect(results).toEqual([]);
  });
});

describe("queryMatchesByDateRange - data verification", () => {
  test("returns complete match data", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-COMPLETE-DATA";

    const match = createMockMatch("TEST_9001", [puuid, "OTHER"], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: generateMatchKey("TEST_9001", date) }],
    });

    s3Mock
      .on(GetObjectCommand, { Key: generateMatchKey("TEST_9001", date) })
      .resolves(createMockGetObjectResponse(JSON.stringify(match)));

    const results = await queryMatchesByDateRange(date, date, [puuid]);

    expect(results.length).toBe(1);
    const retrieved = results[0];
    expect(retrieved).toBeDefined();
    expect(retrieved?.metadata.matchId).toBe("TEST_9001");
    expect(retrieved?.metadata.participants).toContain(puuid);
    expect(retrieved?.info.gameMode).toBe("CLASSIC");
    expect(retrieved?.info.queueId).toBe(420);
  });
});
