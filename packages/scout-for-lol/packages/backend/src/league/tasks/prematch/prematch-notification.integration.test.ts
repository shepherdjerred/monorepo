import { beforeEach, describe, expect, test, mock } from "bun:test";
import {
  PlayerConfigEntrySchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
// Type-only import — does not trigger module evaluation, so it's safe even
// when RUN_INTEGRATION_TEST is false (the runtime import below is gated).
import type { sendPrematchNotification as SendPrematchNotification } from "./prematch-notification.ts";

// TODO(scout-for-lol): bun's `mock.module()` is process-wide and retroactive,
// and this integration test stubs 6 modules with intentionally-narrow shapes.
// Those stubs leak into the rest of the backend suite (e.g. `@scout-for-lol/
// report` ends up missing matchToImage/Report/etc., breaking unrelated
// loading-screen tests). Gated off until these mocks are restructured to
// preserve original exports (e.g. `{ ...(await import(...)), override... }`)
// or the production code is refactored for parameter-based injection.
const RUN_INTEGRATION_TEST = false;

const callOrder: string[] = [];
const sendCalls: { message: Record<string, unknown>; channel: string }[] = [];
const captureExceptionMock = mock(() => "mock-event-id");
const trackedPuuid =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let channelsResult: { serverId: string; channel: string }[] = [];
let payloadSaveStatus: "saved" | "skipped_no_bucket" | "error" = "saved";
let buildLoadingScreenImpl: () => Promise<unknown> = async () => ({
  fake: true,
});

if (RUN_INTEGRATION_TEST) {
  void mock.module("#src/database/index.ts", () => ({
    getChannelsSubscribedToPlayers: async () => {
      callOrder.push("getChannelsSubscribedToPlayers");
      return channelsResult;
    },
  }));

  class MockChannelSendError extends Error {
    permissionError = false;
  }

  void mock.module("#src/league/discord/channel.ts", () => ({
    send: async (message: Record<string, unknown>, channel: string) => {
      sendCalls.push({ message, channel });
      return { id: "mock-message-id" };
    },
    ChannelSendError: MockChannelSendError,
  }));

  void mock.module("#src/storage/s3.ts", () => ({
    savePrematchDataToS3: async () => {
      callOrder.push("savePrematchDataToS3");
      return { status: payloadSaveStatus };
    },
    savePrematchImageToS3: async () => ({ status: "saved" as const }),
    savePrematchSvgToS3: async () => ({ status: "saved" as const }),
  }));

  void mock.module(
    "#src/league/tasks/prematch/loading-screen-builder.ts",
    () => ({
      buildLoadingScreenData: async () => {
        callOrder.push("buildLoadingScreenData");
        return buildLoadingScreenImpl();
      },
    }),
  );

  void mock.module("@scout-for-lol/report", () => ({
    loadingScreenToImage: async () => new Uint8Array([1, 2, 3]),
    loadingScreenToSvg: async () => "<svg></svg>",
  }));

  void mock.module("@sentry/bun", () => ({
    captureException: captureExceptionMock,
    addBreadcrumb: () => "mock-breadcrumb",
  }));
}

// Skip the dynamic import too when gated off — pulling in
// `prematch-notification.ts` triggers `discord/client.ts` module init which
// fails in the test environment without a valid token. The unused stub is
// only ever referenced inside `describe.skipIf(!RUN_INTEGRATION_TEST)`.
const sendPrematchNotificationStub: typeof SendPrematchNotification = () => {
  throw new Error("integration test gated off — see RUN_INTEGRATION_TEST");
};
const { sendPrematchNotification } = RUN_INTEGRATION_TEST
  ? await import("./prematch-notification.ts")
  : { sendPrematchNotification: sendPrematchNotificationStub };

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
  channelsResult = [{ serverId: "123456789012345678", channel: "channel-1" }];
  payloadSaveStatus = "saved";
  buildLoadingScreenImpl = async () => ({ fake: true });
});

describe.skipIf(!RUN_INTEGRATION_TEST)("sendPrematchNotification", () => {
  test("saves raw payload before channel lookup and loading-screen generation", async () => {
    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toEqual([
      "savePrematchDataToS3",
      "getChannelsSubscribedToPlayers",
      "buildLoadingScreenData",
    ]);
    expect(sendCalls).toHaveLength(1);
  });

  test("still saves raw payload when there are no subscribed channels", async () => {
    channelsResult = [];

    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder).toEqual([
      "savePrematchDataToS3",
      "getChannelsSubscribedToPlayers",
    ]);
    expect(sendCalls).toHaveLength(0);
  });

  test("continues delivery when raw payload save fails", async () => {
    payloadSaveStatus = "error";

    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder[0]).toBe("savePrematchDataToS3");
    expect(callOrder).toContain("buildLoadingScreenData");
    expect(sendCalls).toHaveLength(1);
  });

  test("falls back to embed notification when loading-screen generation fails after save attempt", async () => {
    buildLoadingScreenImpl = async () => {
      throw new Error("render failed");
    };

    await sendPrematchNotification(makeGameInfo(), [makeTrackedPlayer()]);

    expect(callOrder[0]).toBe("savePrematchDataToS3");
    expect(sendCalls).toHaveLength(1);
    expect(Array.isArray(sendCalls[0]?.message["embeds"])).toBe(true);
    expect(sendCalls[0]?.message["files"]).toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
