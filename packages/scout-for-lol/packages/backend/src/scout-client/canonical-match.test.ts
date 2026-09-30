import { beforeEach, describe, expect, test, vi } from "vitest";
import { LeaguePuuidSchema, RawMatchSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LocalMatchBundleSchema } from "./canonical/lcu-schema.ts";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientCanonicalMatch: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
    scoutClientObservation: { findMany: mocks.findMany },
  },
}));

const {
  localCanonicalMatchesAgree,
  parseLocalCanonicalMatch,
  resolveLocalCanonicalMatch,
} = await import("./canonical-match.ts");

const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const riotMatchId = RiotMatchIdSchema.parse(fixture.metadata.matchId);
const observer = LeaguePuuidSchema.parse(fixture.metadata.participants[0]);
const LOCAL_GAME_START = 1_780_000_015_000;
const LOCAL_GAME_END = LOCAL_GAME_START + 1_451_000;
const LOCAL_TIMING = {
  gameStartTimestamp: LOCAL_GAME_START,
  gameEndTimestamp: LOCAL_GAME_END,
} as const;
const localMatchHistory: unknown = await Bun.file(
  "../../testdata/lcu-match-history-game.json",
).json();
const localMatchId = RiotMatchIdSchema.parse("NA1_9876543210");
const localObserverPuuid = LeaguePuuidSchema.parse("p".repeat(78));
const localSourceParticipant = fixture.info.participants[0];
if (localSourceParticipant === undefined) {
  throw new Error("Rift fixture has no participant");
}

beforeEach(() => {
  vi.resetAllMocks();
});

function candidate(
  payload: unknown,
  platformId = fixture.info.platformId,
  localPuuid = observer,
) {
  return {
    observationId: "00000000-0000-4000-8000-000000000001",
    platformId,
    localPuuid,
    payload,
    bodyDigest: "a".repeat(64),
  };
}

function localBundleCandidate(timing: {
  readonly gameStartTimestamp: number;
  readonly gameEndTimestamp: number;
}) {
  return candidate(
    {
      data: {
        matchHistory: localMatchHistory,
        endOfGame: {
          players: [
            {
              puuid: localObserverPuuid,
              stats: {
                ...localSourceParticipant,
                puuid: localObserverPuuid,
              },
            },
          ],
        },
        timing,
      },
    },
    "NA1",
    localObserverPuuid,
  );
}

describe("parseLocalCanonicalMatch", () => {
  test("accepts a complete wrapped payload with matching identities", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture })),
    ).toEqual(fixture);
  });

  test("derives metadata around a complete LCU match info payload", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture.info })),
    ).toEqual(fixture);
  });

  test("accepts a complete local history and end-game bundle", () => {
    const converted = parseLocalCanonicalMatch(
      localMatchId,
      localBundleCandidate(LOCAL_TIMING),
    );

    expect(converted).not.toBeNull();
    expect(converted?.metadata).toEqual({
      dataVersion: "local-1",
      matchId: localMatchId,
      participants: [localObserverPuuid],
    });
    expect(converted?.info.endOfGameResult).toBe("GameComplete");
    expect(converted?.info.gameStartTimestamp).toBe(LOCAL_GAME_START);
    expect(converted?.info.gameEndTimestamp).toBe(LOCAL_GAME_END);
    expect(converted?.info.participants[0]).toMatchObject({
      puuid: localObserverPuuid,
      championId: 103,
      kills: localSourceParticipant.kills,
      totalDamageDealtToChampions:
        localSourceParticipant.totalDamageDealtToChampions,
    });
  });

  test("rejects an unaccompanied legacy LCU row", () => {
    expect(
      parseLocalCanonicalMatch(
        localMatchId,
        candidate({ data: localMatchHistory }, "NA1", localObserverPuuid),
      ),
    ).toBeNull();
  });

  test("rejects unknown legacy LCU winner values", () => {
    const parsed = LocalMatchBundleSchema.safeParse({
      matchHistory: localMatchHistory,
      timing: LOCAL_TIMING,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const firstTeam = parsed.data.matchHistory.teams[0];
    expect(firstTeam).toBeDefined();
    if (firstTeam === undefined) return;

    expect(
      LocalMatchBundleSchema.safeParse({
        matchHistory: {
          ...parsed.data.matchHistory,
          teams: [
            { ...firstTeam, win: "Victory" },
            ...parsed.data.matchHistory.teams.slice(1),
          ],
        },
        timing: parsed.data.timing,
      }).success,
    ).toBe(false);
  });

  test("rejects local timing that disagrees with the observed duration", () => {
    expect(
      parseLocalCanonicalMatch(
        localMatchId,
        localBundleCandidate({
          gameStartTimestamp: LOCAL_GAME_START,
          gameEndTimestamp: LOCAL_GAME_START + 15_000,
        }),
      ),
    ).toBeNull();
  });

  test("does not promote partial LCU evidence by inventing missing fields", () => {
    expect(
      parseLocalCanonicalMatch(
        riotMatchId,
        candidate({
          data: {
            gameId: fixture.info.gameId,
            platformId: fixture.info.platformId,
            participants: [],
          },
        }),
      ),
    ).toBeNull();
  });

  test("rejects a payload attributed to another platform", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate(fixture, "EUW1")),
    ).toBeNull();
  });
});

describe("localCanonicalMatchesAgree", () => {
  test("tolerates bounded observer timing differences only", () => {
    const nearby = RawMatchSchema.parse({
      ...fixture,
      info: {
        ...fixture.info,
        gameStartTimestamp: fixture.info.gameStartTimestamp + 1000,
        gameEndTimestamp: fixture.info.gameEndTimestamp + 1000,
      },
    });
    const distant = RawMatchSchema.parse({
      ...fixture,
      info: {
        ...fixture.info,
        gameStartTimestamp: fixture.info.gameStartTimestamp + 31_000,
        gameEndTimestamp: fixture.info.gameEndTimestamp + 31_000,
      },
    });
    const differentFacts = RawMatchSchema.parse({
      ...nearby,
      info: { ...nearby.info, gameDuration: nearby.info.gameDuration + 1 },
    });

    expect(localCanonicalMatchesAgree(fixture, nearby)).toBe(true);
    expect(localCanonicalMatchesAgree(fixture, distant)).toBe(false);
    expect(localCanonicalMatchesAgree(fixture, differentFacts)).toBe(false);
  });
});

describe("resolveLocalCanonicalMatch", () => {
  test("filters by platform before selecting from every promotable candidate", async () => {
    const valid = candidate({ data: fixture });
    const nonParticipant = LeaguePuuidSchema.parse("q".repeat(78));
    const invalid = Array.from({ length: 33 }, (_, index) => ({
      ...candidate({ data: fixture }, fixture.info.platformId, nonParticipant),
      observationId: `invalid-${index.toString()}`,
    }));
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([...invalid, valid]);
    mocks.upsert.mockResolvedValue({ sourceObservation: valid });

    await expect(resolveLocalCanonicalMatch(riotMatchId)).resolves.toEqual(
      fixture,
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        kind: "post_game",
        disposition: "ACCEPTED",
        gameId: fixture.info.gameId.toString(),
        platformId: {
          equals: fixture.info.platformId,
          mode: "insensitive",
        },
        receivedAt: { lte: expect.any(Date) },
      },
      orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
    });
  });
});
