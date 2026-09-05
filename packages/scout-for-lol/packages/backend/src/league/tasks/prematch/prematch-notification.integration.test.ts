import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  PlayerConfigEntrySchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";

const callOrder: string[] = [];
const sendCalls: { message: Record<string, unknown>; channel: string }[] = [];
const captureExceptionMock = vi.fn(() => "mock-event-id");
const recordCoreOutputsDeliveredMock = vi.fn(() => Promise.resolve());
const trackedPuuid =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let channelsResult: {
  serverId: string;
  channel: string;
  subscriptions: {
    subscriptionId: number;
    playerId: number;
    filters: null;
  }[];
}[] = [];
let buildLoadingScreenImpl: () => Promise<unknown> = async () => ({
  fake: true,
});

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  getChannelsSubscribedToPlayers: async () => {
    callOrder.push("getChannelsSubscribedToPlayers");
    return channelsResult;
  },
}));

class MockChannelSendError extends Error {
  permissionError = false;
}

vi.doMock("#src/league/discord/channel.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  send: async (message: Record<string, unknown>, channel: string) => {
    sendCalls.push({ message, channel });
    return { id: "mock-message-id" };
  },
  ChannelSendError: MockChannelSendError,
}));

vi.doMock("#src/storage/s3.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  savePrematchImageToS3: async () => ({ status: "saved" as const }),
  savePrematchSvgToS3: async () => ({ status: "saved" as const }),
}));

vi.doMock(
  "#src/league/tasks/prematch/loading-screen-builder.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    buildLoadingScreenData: async () => {
      callOrder.push("buildLoadingScreenData");
      return buildLoadingScreenImpl();
    },
    fetchParticipantRanks: async () => new Map(),
  }),
);

vi.doMock("#src/analytics/guild-lifecycle.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  recordCoreOutputsDelivered: recordCoreOutputsDeliveredMock,
}));

vi.doMock("#src/betting/markets/prematch-hook.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prepareBucksPrematch: async () => ({
    bettingGuildIds: new Set(),
    rows: [],
    footer: "",
    matchId: "NA1_5500000003",
  }),
}));

vi.doMock("@scout-for-lol/report", async (importOriginal) => ({
  ...(await importOriginal()),
  loadingScreenToImage: async () => new Uint8Array([1, 2, 3]),
  loadingScreenToSvg: async () => "<svg></svg>",
}));

vi.doMock("@sentry/bun", async (importOriginal) => ({
  ...(await importOriginal()),
  captureException: captureExceptionMock,
  addBreadcrumb: () => "mock-breadcrumb",
}));

const { sendPrematchNotification } = await import("./prematch-notification.ts");

function makeGameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_500_000_003,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -20,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 157,
        puuid: trackedPuuid,
        teamId: 100,
        riotId: "Tracked#NA1",
        spell1Id: 4,
        spell2Id: 14,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
      },
    ],
  });
}

function makeArenaGameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_500_000_004,
    gameStartTime: Date.now(),
    gameMode: "CHERRY",
    mapId: 30,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 0,
    gameLength: -20,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 157,
        puuid: trackedPuuid,
        teamId: 100,
        riotId: "Tracked#NA1",
        spell1Id: 2201,
        spell2Id: 2202,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
      },
    ],
  });
}

// Real custom Summoner's Rift game shape: gameType CUSTOM with an unmapped
// queue ID (3110). Regression for the text-only fallback on custom games.
function makeCustomGameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_576_694_431,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "CUSTOM",
    gameQueueConfigId: 3110,
    gameLength: -20,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 420,
        puuid: trackedPuuid,
        teamId: 100,
        riotId: "sjerred#sjerr",
        spell1Id: 12,
        spell2Id: 4,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
      },
    ],
  });
}

function makeTrackedPlayer() {
  return PlayerConfigEntrySchema.parse({
    alias: "Tracked",
    league: {
      leagueAccount: {
        puuid: trackedPuuid,
        region: "AMERICA_NORTH",
      },
    },
  });
}

beforeEach(() => {
  callOrder.length = 0;
  sendCalls.length = 0;
  captureExceptionMock.mockClear();
  recordCoreOutputsDeliveredMock.mockClear();
  channelsResult = [
    {
      serverId: "123456789012345678",
      channel: "channel-1",
      subscriptions: [{ subscriptionId: 1, playerId: 1, filters: null }],
    },
  ];
  buildLoadingScreenImpl = async () => ({ fake: true });
});

describe("sendPrematchNotification", () => {
  test("looks up channels before loading-screen generation", async () => {
    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toEqual([
      "getChannelsSubscribedToPlayers",
      "buildLoadingScreenData",
    ]);
    expect(sendCalls).toHaveLength(1);
  });

  test("returns before analysis when there are no subscribed channels", async () => {
    channelsResult = [];

    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toEqual(["getChannelsSubscribedToPlayers"]);
    expect(sendCalls).toHaveLength(0);
  });

  test("records successful deliveries", async () => {
    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(recordCoreOutputsDeliveredMock).toHaveBeenCalledWith(
      new Set(["123456789012345678"]),
      "prematch",
    );
  });

  test("falls back to embed notification when loading-screen generation fails", async () => {
    buildLoadingScreenImpl = async () => {
      throw new Error("render failed");
    };

    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder[0]).toBe("getChannelsSubscribedToPlayers");
    expect(sendCalls).toHaveLength(1);
    expect(Array.isArray(sendCalls[0]?.message["embeds"])).toBe(true);
    expect(sendCalls[0]?.message["files"]).toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  test("renders loading-screen for Arena (CHERRY) games reported as custom", async () => {
    await sendPrematchNotification(makeArenaGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toContain("buildLoadingScreenData");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.message["content"]).toBe(
      "Tracked started an arena game",
    );
    expect(sendCalls[0]?.message["files"]).toBeDefined();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  test("renders loading-screen image for custom games (unmapped queue 3110)", async () => {
    await sendPrematchNotification(makeCustomGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toContain("buildLoadingScreenData");
    expect(sendCalls).toHaveLength(1);
    // gameType CUSTOM resolves the queue to "custom", so the message reads
    // "custom" rather than leaking the raw gameMode ("CLASSIC").
    expect(sendCalls[0]?.message["content"]).toBe(
      "Tracked started a custom game",
    );
    // Image path taken (files present), not the text-only fallback embed.
    expect(sendCalls[0]?.message["files"]).toBeDefined();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
