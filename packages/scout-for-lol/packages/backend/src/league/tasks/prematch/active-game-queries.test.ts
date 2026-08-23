import { beforeEach, describe, expect, test, vi } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";

type ActiveGameUpdateArgs = {
  where: { prematchMatchId: string };
  data: { prematchMessageIds: string; prematchMatchId: string };
};

type ActiveGameFindUniqueArgs = {
  where: { prematchMatchId: string };
  select: {
    prematchMessageIds?: true;
    postmatchMessageIds?: true;
    prematchMatchId: true;
  };
};

type ActiveGameUpdateManyArgs = {
  where: { prematchMatchId: string };
  data: { postmatchMessageIds: string };
};

let storedPrematchMessageIds: string | null = null;
let storedPostmatchMessageIds: string | null = null;
let storedPrematchMatchId: string | null = null;
let lastUpdate: ActiveGameUpdateArgs | undefined;
let lastUpdateMany: ActiveGameUpdateManyArgs | undefined;
let updateManyError: Error | undefined;

const fakePrisma = {
  activeGame: {
    update: vi.fn(async (args: ActiveGameUpdateArgs) => {
      lastUpdate = args;
      storedPrematchMessageIds = args.data.prematchMessageIds;
      storedPrematchMatchId = args.data.prematchMatchId;
      return {};
    }),
    updateMany: vi.fn(async (args: ActiveGameUpdateManyArgs) => {
      if (updateManyError !== undefined) {
        throw updateManyError;
      }
      lastUpdateMany = args;
      storedPostmatchMessageIds = args.data.postmatchMessageIds;
      storedPrematchMatchId = args.where.prematchMatchId;
      return { count: 1 };
    }),
    findUnique: vi.fn(async (args: ActiveGameFindUniqueArgs) => {
      if (args.select.postmatchMessageIds === true) {
        if (storedPostmatchMessageIds === null) {
          return null;
        }
        return {
          postmatchMessageIds: storedPostmatchMessageIds,
          prematchMatchId: storedPrematchMatchId,
        };
      }
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

await vi.doMock("#src/database/index.ts", () => ({
  prisma: fakePrisma,
  getAccountsWithState: () => Promise.resolve([]),
  getChannelsSubscribedToPlayers: () => Promise.resolve([]),
}));

const {
  getPostmatchMessageIdsForMatchIdOrEmpty,
  getPrematchMessageIds,
  getPrematchMessageIdsForMatchId,
  getPrematchMessageIdsForMatchIdOrEmpty,
  recordPostmatchMessageIds,
  recordPrematchMessageIds,
} = await import("#src/league/tasks/prematch/active-game-queries.ts");

describe("prematch message IDs", () => {
  beforeEach(() => {
    storedPrematchMessageIds = null;
    storedPostmatchMessageIds = null;
    storedPrematchMatchId = null;
    lastUpdate = undefined;
    lastUpdateMany = undefined;
    updateManyError = undefined;
    fakePrisma.activeGame.update.mockClear();
    fakePrisma.activeGame.updateMany.mockClear();
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
      where: { prematchMatchId: "NA1_123" },
      data: {
        prematchMessageIds: JSON.stringify({
          "channel-one": "message-one",
          "channel-two": "message-two",
        }),
        prematchMatchId: "NA1_123",
      },
    });
    await expect(
      getPrematchMessageIds(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(
      new Map([
        ["channel-one", "message-one"],
        ["channel-two", "message-two"],
      ]),
    );
  });

  test("returns no reply targets for a null or empty record", async () => {
    await expect(
      getPrematchMessageIds(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(new Map());

    await recordPrematchMessageIds(MatchIdSchema.parse("NA1_123"), new Map());

    await expect(
      getPrematchMessageIds(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(new Map());
  });

  test("propagates malformed records", async () => {
    storedPrematchMessageIds = "not-json";
    storedPrematchMatchId = "NA1_123";

    await expect(
      getPrematchMessageIds(MatchIdSchema.parse("NA1_123")),
    ).rejects.toThrow();
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

describe("postmatch message IDs", () => {
  beforeEach(() => {
    storedPrematchMessageIds = null;
    storedPostmatchMessageIds = null;
    storedPrematchMatchId = null;
    lastUpdateMany = undefined;
    updateManyError = undefined;
    fakePrisma.activeGame.updateMany.mockClear();
    fakePrisma.activeGame.findUnique.mockClear();
  });

  test("persists and retrieves report message IDs by channel", async () => {
    await recordPostmatchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([
        ["channel-one", "message-one"],
        ["channel-two", "message-two"],
      ]),
    );

    expect(lastUpdateMany).toEqual({
      where: { prematchMatchId: "NA1_123" },
      data: {
        postmatchMessageIds: JSON.stringify({
          "channel-one": "message-one",
          "channel-two": "message-two",
        }),
      },
    });
    await expect(
      getPostmatchMessageIdsForMatchIdOrEmpty(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(
      new Map([
        ["channel-one", "message-one"],
        ["channel-two", "message-two"],
      ]),
    );
  });

  test("writes nothing when no channel received the report", async () => {
    await recordPostmatchMessageIds(MatchIdSchema.parse("NA1_123"), new Map());

    expect(fakePrisma.activeGame.updateMany).not.toHaveBeenCalled();
  });

  // The prematch writer throws; this one must not. It runs after the report has
  // already been delivered, so a failed metadata write must never turn a
  // successful delivery into an exception on the polling path.
  test("swallows a write failure instead of failing the poll", async () => {
    updateManyError = new Error("database is locked");

    await expect(
      recordPostmatchMessageIds(
        MatchIdSchema.parse("NA1_123"),
        new Map([["channel-one", "message-one"]]),
      ),
    ).resolves.toBeUndefined();
  });

  test("returns no reply targets when nothing was recorded", async () => {
    await expect(
      getPostmatchMessageIdsForMatchIdOrEmpty(MatchIdSchema.parse("NA1_123")),
    ).resolves.toEqual(new Map());
  });

  test("returns no reply targets for a non-numeric game ID", async () => {
    await recordPostmatchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([["channel-one", "message-one"]]),
    );

    await expect(
      getPostmatchMessageIdsForMatchIdOrEmpty(
        MatchIdSchema.parse("NA1_not-a-game"),
      ),
    ).resolves.toEqual(new Map());
    expect(fakePrisma.activeGame.findUnique).not.toHaveBeenCalled();
  });

  test("does not reuse reply targets from another platform", async () => {
    await recordPostmatchMessageIds(
      MatchIdSchema.parse("NA1_123"),
      new Map([["channel-one", "message-one"]]),
    );

    await expect(
      getPostmatchMessageIdsForMatchIdOrEmpty(MatchIdSchema.parse("EUW1_123")),
    ).resolves.toEqual(new Map());
  });
});
