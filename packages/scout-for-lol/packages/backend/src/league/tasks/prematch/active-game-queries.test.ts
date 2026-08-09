import { beforeEach, describe, expect, test, mock } from "bun:test";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";

type ActiveGameUpdateArgs = {
  where: { gameId: bigint };
  data: { prematchMessageIds: string; prematchMatchId: string };
};

type ActiveGameFindUniqueArgs = {
  where: { gameId: bigint };
  select: { prematchMessageIds: true; prematchMatchId: true };
};

let storedPrematchMessageIds: string | null = null;
let storedPrematchMatchId: string | null = null;
let lastUpdate: ActiveGameUpdateArgs | undefined;

const fakePrisma = {
  activeGame: {
    update: mock(async (args: ActiveGameUpdateArgs) => {
      lastUpdate = args;
      storedPrematchMessageIds = args.data.prematchMessageIds;
      storedPrematchMatchId = args.data.prematchMatchId;
      return {};
    }),
    findUnique: mock(async (_args: ActiveGameFindUniqueArgs) => {
      if (storedPrematchMessageIds === null) {
        return null;
      }
      return {
        prematchMessageIds: storedPrematchMessageIds,
        prematchMatchId: storedPrematchMatchId,
      };
    }),
  },
};

await mock.module("#src/database/index.ts", () => ({
  prisma: fakePrisma,
  getAccountsWithState: () => Promise.resolve([]),
  getChannelsSubscribedToPlayers: () => Promise.resolve([]),
}));

const {
  getPrematchMessageIds,
  getPrematchMessageIdsForMatchId,
  getPrematchMessageIdsForMatchIdOrEmpty,
  recordPrematchMessageIds,
} = await import("#src/league/tasks/prematch/active-game-queries.ts");

describe("prematch message IDs", () => {
  beforeEach(() => {
    storedPrematchMessageIds = null;
    storedPrematchMatchId = null;
    lastUpdate = undefined;
    fakePrisma.activeGame.update.mockClear();
    fakePrisma.activeGame.findUnique.mockClear();
  });

  test("persists and retrieves message IDs by channel", async () => {
    await recordPrematchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([
        ["channel-one", "message-one"],
        ["channel-two", "message-two"],
      ]),
    );

    expect(lastUpdate).toEqual({
      where: { gameId: 123n },
      data: {
        prematchMessageIds: JSON.stringify({
          "channel-one": "message-one",
          "channel-two": "message-two",
        }),
        prematchMatchId: "NA1_123",
      },
    });
    await expect(getPrematchMessageIds(123)).resolves.toEqual(
      new Map([
        ["channel-one", "message-one"],
        ["channel-two", "message-two"],
      ]),
    );
  });

  test("returns no reply targets for a null or empty record", async () => {
    await expect(getPrematchMessageIds(123)).resolves.toEqual(new Map());

    await recordPrematchMessageIds(MatchIdSchema.parse("NA1_123"), new Map());

    await expect(getPrematchMessageIds(123)).resolves.toEqual(new Map());
  });

  test("propagates malformed records", async () => {
    storedPrematchMessageIds = "not-json";
    storedPrematchMatchId = "NA1_123";

    await expect(getPrematchMessageIds(123)).rejects.toThrow();
    await expect(
      getPrematchMessageIdsForMatchIdOrEmpty(MatchIdSchema.parse("NA1_123")),
    ).rejects.toThrow();
  });

  test("resolves the numeric game ID from a match ID", async () => {
    await recordPrematchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([["channel-one", "message-one"]]),
    );

    await expect(
      getPrematchMessageIdsForMatchId(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(new Map([["channel-one", "message-one"]]));
    await expect(
      getPrematchMessageIdsForMatchId(MatchIdSchema.parse("NA1_not-a-game")),
    ).resolves.toEqual(new Map());
  });

  test("does not reuse reply targets from another platform", async () => {
    await recordPrematchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([["channel-one", "message-one"]]),
    );

    await expect(
      getPrematchMessageIdsForMatchId(MatchIdSchema.parse("EUW1_123")),
    ).resolves.toEqual(new Map());
  });
});
