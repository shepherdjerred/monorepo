/**
 * S3 Query Integration Tests using aws-sdk-client-mock
 *
 * These tests use in-memory mocking via aws-sdk-client-mock instead of real S3.
 * This makes them fast, reliable, and doesn't require AWS credentials.
 *
 * Environment setup is handled automatically by test-setup.ts (preloaded via bunfig.toml)
 */

import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { RawMatch } from "@scout-for-lol/data";
import { queryMatchesByDateRange } from "#src/storage/s3-query.ts";

// Create S3 mock
const s3Mock = mockClient(S3Client);

// Helper to create a mock match
function createMockMatch(
  matchIdValue: string,
  participantPuuids: string[],
  gameCreationDate: Date,
): RawMatch {
  const matchId = RiotMatchIdSchema.parse(matchIdValue);
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
      gameEndTimestamp: gameCreationDate.getTime() + 1_800_000,
      gameId: Number.parseInt(matchId.replace("NA1_", "")),
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

// Helper to create a mock GetObjectCommandOutput.
// SdkStream can't be constructed in test code, so we return a partial mock
// and use callsFake() (which accepts any return type) instead of resolves().
function createMockGetObjectResponse(content: string) {
  return {
    Body: {
      transformToString: () => Promise.resolve(content),
    },
    $metadata: {},
  };
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
    const match1 = createMockMatch(
      "NA1_9100000000",
      [puuid1, "PUUID-OTHER-1"],
      date,
    );
    const match2 = createMockMatch(
      "NA1_9100000010",
      [puuid2, "PUUID-OTHER-2"],
      date,
    );
    const match3 = createMockMatch("NA1_9100000020", [puuid1, puuid2], date);

    const prefix = "games/2025/01/15/";

    // Mock S3 ListObjectsV2
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000000", date),
        },
        {
          Key: generateMatchKey("NA1_9100000010", date),
        },
        {
          Key: generateMatchKey("NA1_9100000020", date),
        },
      ],
    });

    // Mock S3 GetObject for each match
    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000000", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000010", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000020", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match3)));

    await expectRangeMatchIds(
      date,
      date,
      [puuid1, puuid2],
      ["NA1_9100000000", "NA1_9100000010", "NA1_9100000020"],
    );
  });

  test("paginates through all S3 list results for a day", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-PAGINATION";
    const prefix = "games/2025/01/15/";
    const match1 = createMockMatch("NA1_9100000030", [puuid], date);
    const match2 = createMockMatch("NA1_9100000040", [puuid], date);
    const key1 = generateMatchKey("NA1_9100000030", date);
    const key2 = generateMatchKey("NA1_9100000040", date);

    s3Mock
      .on(ListObjectsV2Command, { Prefix: prefix })
      .resolvesOnce({
        Contents: [{ Key: key1 }],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      })
      .resolvesOnce({ Contents: [{ Key: key2 }], IsTruncated: false });
    s3Mock
      .on(GetObjectCommand, { Key: key1 })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match1)));
    s3Mock
      .on(GetObjectCommand, { Key: key2 })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match2)));

    const results = await queryMatchesByDateRange(
      new Date("2025-01-15T00:00:00Z"),
      new Date("2025-01-15T23:59:59Z"),
      [puuid],
      new Map(),
    );

    expect(results.map((m) => m.metadata.matchId).toSorted()).toEqual([
      "NA1_9100000030",
      "NA1_9100000040",
    ]);
  });

  test("filters parsed matches by actual game creation time", async () => {
    const requestedDate = new Date("2025-01-15T12:00:00Z");
    const previousDate = new Date("2025-01-14T23:59:59Z");
    const puuid = "PUUID-ACTUAL-GAME-TIME";
    const prefix = "games/2025/01/15/";
    const inWindowMatch = createMockMatch(
      "NA1_9100000060",
      [puuid],
      requestedDate,
    );
    const outsideWindowMatch = createMockMatch(
      "NA1_9100000070",
      [puuid],
      previousDate,
    );
    const inWindowKey = generateMatchKey("NA1_9100000060", requestedDate);
    const outsideWindowKey = generateMatchKey("NA1_9100000070", requestedDate);

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: inWindowKey }, { Key: outsideWindowKey }],
    });
    s3Mock
      .on(GetObjectCommand, { Key: inWindowKey })
      .callsFake(() =>
        createMockGetObjectResponse(JSON.stringify(inWindowMatch)),
      );
    s3Mock
      .on(GetObjectCommand, { Key: outsideWindowKey })
      .callsFake(() =>
        createMockGetObjectResponse(JSON.stringify(outsideWindowMatch)),
      );

    const results = await queryMatchesByDateRange(
      new Date("2025-01-15T00:00:00Z"),
      new Date("2025-01-15T23:59:59Z"),
      [puuid],
      new Map(),
    );

    expect(results.map((m) => m.metadata.matchId)).toEqual(["NA1_9100000060"]);
  });

  test("filters matches by participant PUUID", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const targetPuuid = "PUUID-TARGET";
    const otherPuuid = "PUUID-OTHER";

    // Create mock matches: 2 with targetPuuid, 1 without
    const match1 = createMockMatch(
      "NA1_9100000030",
      [targetPuuid, otherPuuid],
      date,
    );
    const match2 = createMockMatch(
      "NA1_9100000040",
      [otherPuuid, "PUUID-ANOTHER"],
      date,
    );
    const match3 = createMockMatch(
      "NA1_9100000050",
      [targetPuuid, "PUUID-ANOTHER"],
      date,
    );

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000030", date),
        },
        {
          Key: generateMatchKey("NA1_9100000040", date),
        },
        {
          Key: generateMatchKey("NA1_9100000050", date),
        },
      ],
    });

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000030", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000040", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000050", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match3)));

    await expectRangeMatchIds(
      date,
      date,
      [targetPuuid],
      ["NA1_9100000030", "NA1_9100000050"],
    );
  });

  test("returns empty array when no matches found", async () => {
    const date = new Date("2025-01-20T12:00:00Z");
    const puuid = "PUUID-NONEXISTENT";

    const prefix = "games/2025/01/20/";

    // Mock empty S3 response
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [],
    });

    const results = await queryMatchesByDateRange(
      date,
      date,
      [puuid],
      new Map(),
    );

    expect(results).toEqual([]);
  });
});

/**
 * Stub S3 the way it actually serves a day range: one listing per day prefix,
 * then the object for each key. Shared because several range tests set up the
 * identical three-day shape and differ only in ids and dates.
 */
/**
 * Run a range query and assert exactly which matches come back. Shared because
 * every range test differs only in the window, the PUUIDs, and the expected ids.
 */
async function expectRangeMatchIds(
  from: Date,
  to: Date,
  puuids: string[],
  expected: string[],
): Promise<void> {
  const results = await queryMatchesByDateRange(from, to, puuids, new Map());
  expect(results.map((m) => m.metadata.matchId).toSorted()).toEqual(expected);
}

function stubMatchesByDay(
  entries: readonly {
    id: string;
    date: Date;
    match: ReturnType<typeof createMockMatch>;
  }[],
): void {
  for (const { id, date, match } of entries) {
    const key = generateMatchKey(id, date);
    const prefix = `games/${date.toISOString().slice(0, 10).replaceAll("-", "/")}/`;
    s3Mock
      .on(ListObjectsV2Command, { Prefix: prefix })
      .resolves({ Contents: [{ Key: key }] });
    s3Mock
      .on(GetObjectCommand, { Key: key })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match)));
  }
}

describe("queryMatchesByDateRange - date range", () => {
  test("returns matches across multiple days", async () => {
    const puuid = "PUUID-MULTIDAY";

    const date1 = new Date("2025-01-15T12:00:00Z");
    const date2 = new Date("2025-01-16T12:00:00Z");
    const date3 = new Date("2025-01-17T12:00:00Z");

    // Create matches on 3 consecutive days
    const match1 = createMockMatch("NA1_9100000080", [puuid, "OTHER-1"], date1);
    const match2 = createMockMatch("NA1_9100000090", [puuid, "OTHER-2"], date2);
    const match3 = createMockMatch("NA1_9100000100", [puuid, "OTHER-3"], date3);

    stubMatchesByDay([
      { id: "NA1_9100000080", date: date1, match: match1 },
      { id: "NA1_9100000090", date: date2, match: match2 },
      { id: "NA1_9100000100", date: date3, match: match3 },
    ]);

    await expectRangeMatchIds(
      date1,
      date3,
      [puuid],
      ["NA1_9100000080", "NA1_9100000090", "NA1_9100000100"],
    );
  });

  test("handles partial date ranges", async () => {
    const puuid = "PUUID-PARTIAL";

    const date2 = new Date("2025-01-16T12:00:00Z");
    const date3 = new Date("2025-01-17T12:00:00Z");

    // Create matches on 2 days (we query only date2 to date3)
    const match2 = createMockMatch("NA1_9100000110", [puuid], date2);
    const match3 = createMockMatch("NA1_9100000120", [puuid], date3);

    // Mock S3 responses - only for days 2 and 3 (we're querying date2 to date3)
    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/16/" }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000110", date2),
        },
      ],
    });

    s3Mock.on(ListObjectsV2Command, { Prefix: "games/2025/01/17/" }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000120", date3),
        },
      ],
    });

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000110", date2),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000120", date3),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match3)));

    await expectRangeMatchIds(
      date2,
      date3,
      [puuid],
      ["NA1_9100000110", "NA1_9100000120"],
    );
  });

  test("handles month boundary crossing", async () => {
    const puuid = "PUUID-MONTH-CROSS";

    const date1 = new Date("2025-01-31T12:00:00Z");
    const date2 = new Date("2025-02-01T12:00:00Z");
    const date3 = new Date("2025-02-02T12:00:00Z");

    const match1 = createMockMatch("NA1_9100000130", [puuid], date1);
    const match2 = createMockMatch("NA1_9100000140", [puuid], date2);
    const match3 = createMockMatch("NA1_9100000150", [puuid], date3);

    stubMatchesByDay([
      { id: "NA1_9100000130", date: date1, match: match1 },
      { id: "NA1_9100000140", date: date2, match: match2 },
      { id: "NA1_9100000150", date: date3, match: match3 },
    ]);

    await expectRangeMatchIds(
      date1,
      date3,
      [puuid],
      ["NA1_9100000130", "NA1_9100000140", "NA1_9100000150"],
    );
  });
});

describe("queryMatchesByDateRange - edge cases", () => {
  test("returns empty array when PUUIDs array is empty", async () => {
    const date = new Date("2025-01-15T12:00:00Z");

    const results = await queryMatchesByDateRange(date, date, [], new Map());

    expect(results).toEqual([]);
  });

  test("handles invalid JSON in S3 gracefully", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-INVALID-JSON";

    // Valid match
    const validMatch = createMockMatch("NA1_9100000160", [puuid], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000160", date),
        },
        {
          Key: generateMatchKey("NA1_9100000170", date),
        },
      ],
    });

    // Valid match returns proper JSON
    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000160", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(validMatch)));

    // Invalid match returns malformed JSON
    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000170", date),
      })
      .callsFake(() => createMockGetObjectResponse("{ invalid json content"));

    // Query should skip invalid JSON and return valid match
    const results = await queryMatchesByDateRange(
      date,
      date,
      [puuid],
      new Map(),
    );

    expect(results.length).toBe(1);
    expect(results[0]?.metadata.matchId).toBe("NA1_9100000160");
  });

  test("handles multiple participants correctly", async () => {
    const date = new Date("2025-01-15T12:00:00Z");

    const puuid1 = "PUUID-PLAYER-1";
    const puuid2 = "PUUID-PLAYER-2";
    const puuid3 = "PUUID-PLAYER-3";

    // Match with puuid1 and puuid2
    const match1 = createMockMatch(
      "NA1_9100000180",
      [puuid1, puuid2, "OTHER-1"],
      date,
    );
    // Match with puuid2 and puuid3
    const match2 = createMockMatch(
      "NA1_9100000190",
      [puuid2, puuid3, "OTHER-2"],
      date,
    );
    // Match with puuid1 only
    const match3 = createMockMatch(
      "NA1_9100000200",
      [puuid1, "OTHER-3", "OTHER-4"],
      date,
    );

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000180", date),
        },
        {
          Key: generateMatchKey("NA1_9100000190", date),
        },
        {
          Key: generateMatchKey("NA1_9100000200", date),
        },
      ],
    });

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000180", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match1)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000190", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match2)));

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000200", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match3)));

    await expectRangeMatchIds(
      date,
      date,
      [puuid1, puuid2],
      ["NA1_9100000180", "NA1_9100000190", "NA1_9100000200"],
    );
  });

  test("handles S3 GetObject errors gracefully", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-ERROR-TEST";

    const validMatch = createMockMatch("NA1_9100000210", [puuid], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000210", date),
        },
        {
          Key: generateMatchKey("NA1_9100000220", date),
        },
      ],
    });

    // First match returns successfully
    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000210", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(validMatch)));

    // Second match throws error
    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000220", date),
      })
      .rejects(new Error("S3 GetObject failed"));

    // Query should handle error and return valid match
    const results = await queryMatchesByDateRange(
      date,
      date,
      [puuid],
      new Map(),
    );

    expect(results.length).toBe(1);
    expect(results[0]?.metadata.matchId).toBe("NA1_9100000210");
  });
});

describe("queryMatchesByDateRange - S3 configuration", () => {
  test("returns empty array when PUUIDs array is empty", async () => {
    // This tests the early return for empty PUUIDs
    const date = new Date("2025-01-15T12:00:00Z");

    const results = await queryMatchesByDateRange(date, date, [], new Map());

    expect(results).toEqual([]);
  });
});

describe("queryMatchesByDateRange - data verification", () => {
  test("returns complete match data", async () => {
    const date = new Date("2025-01-15T12:00:00Z");
    const puuid = "PUUID-COMPLETE-DATA";

    const match = createMockMatch("NA1_9100000230", [puuid, "OTHER"], date);

    const prefix = "games/2025/01/15/";

    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [
        {
          Key: generateMatchKey("NA1_9100000230", date),
        },
      ],
    });

    s3Mock
      .on(GetObjectCommand, {
        Key: generateMatchKey("NA1_9100000230", date),
      })
      .callsFake(() => createMockGetObjectResponse(JSON.stringify(match)));

    const results = await queryMatchesByDateRange(
      date,
      date,
      [puuid],
      new Map(),
    );

    expect(results.length).toBe(1);
    const retrieved = results[0];
    expect(retrieved).toBeDefined();
    expect(retrieved?.metadata.matchId).toBe("NA1_9100000230");
    expect(retrieved?.metadata.participants).toContain(puuid);
    expect(retrieved?.info.gameMode).toBe("CLASSIC");
    expect(retrieved?.info.queueId).toBe(420);
  });
});
