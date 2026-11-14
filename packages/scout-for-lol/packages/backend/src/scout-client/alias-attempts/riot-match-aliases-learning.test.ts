import { beforeEach, describe, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { riotMatchWithSeats } from "#src/testing/riot-match-seats.ts";

type StoredObservation = { disposition: string; payload: unknown };

const mocks = vi.hoisted(() => ({
  observations: Array.of<StoredObservation>(),
  observationFindMany: vi.fn(),
  aliasFindUnique: vi.fn(),
  aliasCreateMany: vi.fn(),
  attemptFindUnique: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientObservation: { findMany: mocks.observationFindMany },
    leagueIdentityAlias: {
      findUnique: mocks.aliasFindUnique,
      createMany: mocks.aliasCreateMany,
      update: vi.fn(),
    },
    leagueIdentityAliasAttempt: {
      findUnique: mocks.attemptFindUnique,
      update: vi.fn(),
    },
  },
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isFeatureHardDisabled: () => false,
}));

const { learnAliasesFromRiotMatch } = await import("./riot-match-aliases.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_77");
const FRIEND_UUID = "6a7b8c9d-0e1f-4203-9405-a6b7c8d9e0f1";
const FRIEND_PUUID = "f".repeat(78);

const payload = {
  data: {
    matchHistory: {
      participants: [{ participantId: 2, teamId: 200, championId: 2 }],
      participantIdentities: [
        {
          participantId: 2,
          player: { puuid: FRIEND_UUID, gameName: "n", tagLine: "t" },
        },
      ],
    },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.observations.length = 0;
  // Honour the disposition filter the way the database would.
  mocks.observationFindMany.mockImplementation(
    async (args: { where: { disposition?: string } }) =>
      mocks.observations.filter(
        (row) =>
          args.where.disposition === undefined ||
          row.disposition === args.where.disposition,
      ),
  );
  mocks.aliasFindUnique.mockResolvedValue(null);
  mocks.aliasCreateMany.mockResolvedValue({ count: 1 });
  mocks.attemptFindUnique.mockResolvedValue(null);
});

describe("learning aliases from a Riot-published game", () => {
  test("a quarantined observation never mints a riot_match alias", async () => {
    mocks.observations.push({ disposition: "QUARANTINED", payload });
    const riot = await riotMatchWithSeats(MATCH_ID, [
      { participantId: 2, teamId: 200, championId: 2, puuid: FRIEND_PUUID },
    ]);

    expect(await learnAliasesFromRiotMatch(riot)).toBe(0);
    expect(mocks.aliasCreateMany).not.toHaveBeenCalled();
  });

  test("an accepted observation does mint one", async () => {
    mocks.observations.push({ disposition: "ACCEPTED", payload });
    const riot = await riotMatchWithSeats(MATCH_ID, [
      { participantId: 2, teamId: 200, championId: 2, puuid: FRIEND_PUUID },
    ]);

    expect(await learnAliasesFromRiotMatch(riot)).toBe(1);
    expect(mocks.aliasCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            lcuUuid: FRIEND_UUID,
            source: "riot_match",
          }),
        ],
      }),
    );
  });
});
