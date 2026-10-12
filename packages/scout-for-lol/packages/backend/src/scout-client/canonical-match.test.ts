import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  LeaguePuuidSchema,
  RawMatchSchema,
  SCOUT_CLIENT_DATA_VERSION,
  type RawMatch,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
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
const riotMatchId = fixture.metadata.matchId;
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

/** A match as selected from a client: stamped as the client's, whatever it claimed. */
function asClientMatch(match: RawMatch): RawMatch {
  return {
    ...match,
    metadata: { ...match.metadata, dataVersion: SCOUT_CLIENT_DATA_VERSION },
  };
}

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

/** The local player's opponent in a 1v1: a second player on team 200. */
const localOpponentPuuid = LeaguePuuidSchema.parse("q".repeat(78));

const LocalHistoryRowSchema = z.looseObject({
  participantIdentities: z.array(
    z.looseObject({
      participantId: z.number(),
      player: z.looseObject({}),
    }),
  ),
  participants: z.array(z.looseObject({ participantId: z.number() })),
});

/**
 * The real one-player list row, completed with an opponent so the game fields
 * two sides, as `games/{id}` reports a 1v1 custom.
 */
function twoPlayerHistory(): unknown {
  const row = LocalHistoryRowSchema.parse(localMatchHistory);
  const [identity] = row.participantIdentities;
  const [participant] = row.participants;
  if (identity === undefined || participant === undefined) {
    throw new Error("History fixture has no local player");
  }
  return {
    ...row,
    participantIdentities: [
      identity,
      {
        ...identity,
        participantId: 2,
        player: { ...identity.player, puuid: localOpponentPuuid },
      },
    ],
    participants: [
      participant,
      { ...participant, participantId: 2, teamId: 200 },
    ],
  };
}

function localBundleCandidate(timing: {
  readonly gameStartTimestamp: number;
  readonly gameEndTimestamp: number;
}) {
  return candidate(
    {
      data: {
        matchHistory: twoPlayerHistory(),
        endOfGame: {
          players: [localObserverPuuid, localOpponentPuuid].map((puuid) => ({
            puuid,
            stats: { ...localSourceParticipant, puuid },
          })),
        },
        timing,
      },
    },
    "NA1",
    localObserverPuuid,
  );
}

/** The observer's League-client UUID, as the client actually reports it. */
const LOCAL_LCU_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

function renamedObserver(payload: unknown): unknown {
  return JSON.parse(
    JSON.stringify(payload).replaceAll(localObserverPuuid, LOCAL_LCU_UUID),
  );
}

/** A candidate whose observer and payload carry the UUID, not the PUUID. */
function asClientSentIt(named: ReturnType<typeof candidate>) {
  return {
    ...named,
    localPuuid: LOCAL_LCU_UUID,
    payload: renamedObserver(named.payload),
  };
}

describe("parseLocalCanonicalMatch", () => {
  test("accepts a complete wrapped payload with matching identities", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture })),
    ).toEqual(asClientMatch(fixture));
  });

  test("derives metadata around a complete LCU match info payload", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture.info })),
    ).toEqual(asClientMatch(fixture));
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
      participants: [localObserverPuuid, localOpponentPuuid],
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

  test("translates a bundle that names players by League-client UUID", () => {
    // Real client payloads look like this: every identity is a 36-character
    // UUID, and only the alias table connects it to the Riot PUUID.
    const converted = parseLocalCanonicalMatch(
      localMatchId,
      asClientSentIt(localBundleCandidate(LOCAL_TIMING)),
      new Map([[LOCAL_LCU_UUID, localObserverPuuid]]),
    );

    expect(converted?.metadata.participants).toEqual([
      localObserverPuuid,
      localOpponentPuuid,
    ]);
    expect(converted?.info.participants[0]?.puuid).toBe(localObserverPuuid);
  });

  test("refuses a bundle whose players have no alias yet", () => {
    // A canonical match is read downstream as Riot data; one that still names
    // a player by UUID would join to nothing, or to the wrong rows.
    expect(
      parseLocalCanonicalMatch(
        localMatchId,
        asClientSentIt(localBundleCandidate(LOCAL_TIMING)),
      ),
    ).toBeNull();
  });

  test("refuses a one-player list row even with its end-of-game block", () => {
    // What an older client sent: the history list's row names only the local
    // player. Promoting it would publish a one-player match as the game.
    expect(
      parseLocalCanonicalMatch(
        localMatchId,
        candidate(
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
              timing: LOCAL_TIMING,
            },
          },
          "NA1",
          localObserverPuuid,
        ),
      ),
    ).toBeNull();
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
      asClientMatch(fixture),
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
      },
      orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
    });
  });

  test("gives Riot two minutes on a matchmade game", async () => {
    const now = new Date();
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([
      { ...candidate({ data: fixture }), receivedAt: now },
    ]);

    await expect(
      resolveLocalCanonicalMatch(riotMatchId, now),
    ).resolves.toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  test("uses a custom's client payload as soon as it arrives", async () => {
    // Riot almost never publishes a custom, so waiting only delays the report.
    const custom = RawMatchSchema.parse({
      ...fixture,
      info: { ...fixture.info, gameType: "CUSTOM_GAME" },
    });
    const now = new Date();
    const fresh = { ...candidate({ data: custom }), receivedAt: now };
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([fresh]);
    mocks.upsert.mockResolvedValue({ sourceObservation: fresh });

    await expect(resolveLocalCanonicalMatch(riotMatchId, now)).resolves.toEqual(
      asClientMatch(custom),
    );
  });
});
