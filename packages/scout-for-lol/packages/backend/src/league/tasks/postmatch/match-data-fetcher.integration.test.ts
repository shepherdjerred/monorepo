import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MatchIdSchema,
  missingExpectedMatchFields,
  RawMatchSchema,
  RegionSchema,
} from "@scout-for-lol/data/index.ts";
import {
  omitFields,
  toCustomLobby,
} from "@scout-for-lol/data/testing/custom-match-fixture.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const RIFT_PATH = `${import.meta.dir}/../../../../../../testdata/rift.json`;

const EXPECTED_FIELDS = [
  "info.endOfGameResult",
  "info.participants[].summonerId",
];

const savedPayloads: { matchId: string; issueCount: number }[] = [];
let matchResponse: unknown;
let matchFailure: Error | null = null;

vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: {
    match: {
      get: () =>
        matchFailure === null
          ? Promise.resolve(matchResponse)
          : Promise.reject(matchFailure),
      timeline: () => Promise.resolve(undefined),
    },
  },
}));

vi.doMock("#src/storage/s3-helpers.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  saveFailedPayloadToS3: (config: {
    matchId: string;
    validationError: { issues: readonly unknown[] };
  }) => {
    savedPayloads.push({
      matchId: config.matchId,
      issueCount: config.validationError.issues.length,
    });
    return Promise.resolve();
  },
}));

const { fetchMatchData } =
  await import("#src/league/tasks/postmatch/match-data-fetcher.ts");

const matchId = MatchIdSchema.parse("NA1_5421167767");
const region = RegionSchema.parse("AMERICA_NORTH");

async function riftMatch() {
  const raw: unknown = JSON.parse(await Bun.file(RIFT_PATH).text());
  return RawMatchSchema.parse(raw);
}

describe("fetchMatchData completeness gate", () => {
  beforeEach(() => {
    savedPayloads.length = 0;
    matchFailure = null;
  });

  test("returns a complete matchmade payload", async () => {
    matchResponse = await riftMatch();

    const result = await fetchMatchData(matchId, region);

    expect(result?.metadata.matchId).toBe("NA1_5421167767");
    expect(savedPayloads).toHaveLength(0);
  });

  test("throws a transient Riot failure in 404-only mode", async () => {
    const failure = new Error("temporary transport failure");
    matchFailure = failure;

    await expect(
      fetchMatchData(matchId, region, "return_undefined_on_404"),
    ).rejects.toBe(failure);
  });

  test("returns undefined for a definitive Riot 404 in 404-only mode", async () => {
    matchFailure = new RiotHttpError({
      status: 404,
      statusText: "Not Found",
      body: null,
      url: "https://riot.invalid/match",
      headers: new Headers(),
    });

    await expect(
      fetchMatchData(matchId, region, "return_undefined_on_404"),
    ).resolves.toBeUndefined();
  });

  test("REJECTS a matchmade payload missing expected fields", async () => {
    // The most important assertion in this change: making those fields
    // optional so custom games parse must not weaken matchmade validation by
    // one bit. A ranked match missing endOfGameResult is still a real problem.
    matchResponse = omitFields(await riftMatch(), EXPECTED_FIELDS);

    const result = await fetchMatchData(matchId, region);

    expect(result).toBeUndefined();
    expect(savedPayloads).toEqual([
      { matchId: "NA1_5421167767", issueCount: EXPECTED_FIELDS.length },
    ]);
  });

  test("throws incomplete matchmade data in 404-only mode", async () => {
    matchResponse = omitFields(await riftMatch(), EXPECTED_FIELDS);

    await expect(
      fetchMatchData(matchId, region, "return_undefined_on_404"),
    ).rejects.toThrow("missing required fields");
    expect(savedPayloads).toEqual([
      { matchId: "NA1_5421167767", issueCount: EXPECTED_FIELDS.length },
    ]);
  });

  test("ACCEPTS a custom payload missing the same fields", async () => {
    const custom = toCustomLobby(await riftMatch(), 3, 3);
    matchResponse = omitFields(custom, EXPECTED_FIELDS);

    const result = await fetchMatchData(matchId, region);

    expect(result?.info.gameType).toBe("CUSTOM_GAME");
    expect(result?.info.participants).toHaveLength(6);
    // Tolerated, so nothing is filed as a validation failure.
    expect(savedPayloads).toHaveLength(0);
  });

  test("accepts a complete custom payload untouched", async () => {
    matchResponse = toCustomLobby(await riftMatch(), 1, 1);

    const result = await fetchMatchData(matchId, region);

    expect(result?.info.participants).toHaveLength(2);
    expect(savedPayloads).toHaveLength(0);
  });

  test("accepts a captured production Clash Match-V5 payload", async () => {
    const clashPath = `${import.meta.dir}/testdata/match-clash-s3.json`;
    const clashMatch = RawMatchSchema.parse(
      JSON.parse(await Bun.file(clashPath).text()),
    );
    expect(clashMatch.info.queueId).toBe(700);
    expect(clashMatch.info.gameType).toBe("MATCHED_GAME");
    expect(missingExpectedMatchFields(clashMatch)).toEqual([]);

    matchResponse = clashMatch;
    const result = await fetchMatchData(matchId, region);

    expect(result?.metadata.matchId).toBe("EUW1_7721480520");
    expect(result?.info.queueId).toBe(700);
    expect(savedPayloads).toHaveLength(0);
  });
});
