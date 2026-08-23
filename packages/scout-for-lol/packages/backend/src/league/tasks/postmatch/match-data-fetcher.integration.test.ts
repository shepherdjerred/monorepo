import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MatchIdSchema,
  RawMatchSchema,
  RegionSchema,
} from "@scout-for-lol/data/index.ts";
import {
  omitFields,
  toCustomLobby,
} from "@scout-for-lol/data/testing/custom-match-fixture.ts";

const RIFT_PATH = `${import.meta.dir}/../../../../../../testdata/rift.json`;

const EXPECTED_FIELDS = [
  "info.endOfGameResult",
  "info.participants[].summonerId",
];

const savedPayloads: { matchId: string; issueCount: number }[] = [];
let matchResponse: unknown;

vi.doMock("#src/league/api/api.ts", () => ({
  api: {
    MatchV5: {
      get: () => Promise.resolve({ response: matchResponse }),
    },
  },
  riotApi: {},
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
  });

  test("returns a complete matchmade payload", async () => {
    matchResponse = await riftMatch();

    const result = await fetchMatchData(matchId, region);

    expect(result?.metadata.matchId).toBe("NA1_5421167767");
    expect(savedPayloads).toHaveLength(0);
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
});
