import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import type { MessageCreateOptions } from "discord.js";
import type {
  SubscribedChannel,
  SubscribedChannelSubscription,
} from "#src/database/index.ts";
import type { ChannelDeliveryEvent } from "#src/durable/match/delivery-intents.ts";

const sentMessages: MessageCreateOptions[] = [];
let failReplyOnce = false;
let failAll = false;
class MockChannelSendError extends Error {
  permissionError: boolean;

  constructor(message: string, permissionError: boolean) {
    super(message);
    this.permissionError = permissionError;
    this.replyPermissionError = true;
  }

  replyPermissionError: boolean;
}

await vi.doMock("#src/league/discord/channel.ts", () => ({
  ChannelSendError: MockChannelSendError,
  isReplyPermissionError: (error: MockChannelSendError) =>
    error.replyPermissionError,
  send: (message: MessageCreateOptions) => {
    if (failAll) {
      throw new MockChannelSendError("missing Send Messages", true);
    }
    if (failReplyOnce && message.reply !== undefined) {
      failReplyOnce = false;
      throw new MockChannelSendError("missing Read Message History", true);
    }
    sentMessages.push(message);
    return Promise.resolve({
      id: `sent-message-${sentMessages.length.toString()}`,
    });
  },
}));

const ALREADY_SENT_MESSAGE_ID = "300000000000000007";
const CLAIMED_AT = new Date("2026-09-12T09:30:00.000Z");
const COMPLETED_AT = new Date("2026-09-12T09:30:02.000Z");
let claimResult: "execute" | "completed" = "execute";

await vi.doMock("#src/temporal/effect-claims.ts", () => ({
  claimScoutEffect: () => Promise.resolve(claimResult),
  completeScoutEffectWithResult: () => Promise.resolve(),
  recordScoutEffectFailure: () => Promise.resolve(),
  requireCompletedScoutEffectResult: (key: string) =>
    Promise.resolve({
      key,
      resultId: ALREADY_SENT_MESSAGE_ID,
      claimedAt: CLAIMED_AT,
      completedAt: COMPLETED_AT,
    }),
}));

const { channelsPassingQueueFilter, deliverToChannels } =
  await import("#src/league/tasks/notification-filters.ts");

function subscription(
  overrides: Partial<SubscribedChannelSubscription>,
): SubscribedChannelSubscription {
  return {
    subscriptionId: 1,
    playerId: 1,
    filters: null,
    isMuted: false,
    ...overrides,
  };
}

function channel(
  subscriptions: SubscribedChannelSubscription[],
): SubscribedChannel {
  return {
    channel: DiscordChannelIdSchema.parse("200000000000000009"),
    serverId: "100000000000000009",
    subscriptions,
  };
}

describe("channelsPassingQueueFilter — mute", () => {
  test("drops a channel whose only subscription is muted", () => {
    const kept = channelsPassingQueueFilter(
      [channel([subscription({ isMuted: true })])],
      "solo",
    );
    expect(kept).toHaveLength(0);
  });

  test("keeps a channel when at least one unmuted subscription passes", () => {
    const kept = channelsPassingQueueFilter(
      [
        channel([
          subscription({ subscriptionId: 1, isMuted: true }),
          subscription({ subscriptionId: 2, playerId: 2, isMuted: false }),
        ]),
      ],
      "solo",
    );
    expect(kept).toHaveLength(1);
  });

  test("a muted subscription cannot satisfy the queue filter for the channel", () => {
    const kept = channelsPassingQueueFilter(
      [
        channel([
          subscription({ subscriptionId: 1, isMuted: true, filters: null }),
          subscription({
            subscriptionId: 2,
            playerId: 2,
            filters: {
              version: 1,
              filters: [{ type: "queue", queues: ["arena"] }],
            },
          }),
        ]),
      ],
      "solo",
    );
    expect(kept).toHaveLength(0);
  });

  test("unmuted notify-all subscriptions keep passing (baseline)", () => {
    const kept = channelsPassingQueueFilter(
      [channel([subscription({})])],
      "solo",
    );
    expect(kept).toHaveLength(1);
  });
});

describe("deliverToChannels", () => {
  beforeEach(() => {
    sentMessages.length = 0;
    failReplyOnce = false;
    failAll = false;
    claimResult = "execute";
  });

  test("confirms the intent for a send an earlier run already completed", async () => {
    claimResult = "completed";
    const channelId = DiscordChannelIdSchema.parse("123456789012345678");
    const recorded: ChannelDeliveryEvent[] = [];

    const delivery = await deliverToChannels({
      message: { content: "Game finished" },
      channels: [{ channel: channelId, serverId: "123456789012345680" }],
      logPrefix: "[test]",
      sentryTags: {},
      effectKeyPrefix: "postmatch-discord:NA1_1",
      recordDelivery: (event) => {
        recorded.push(event);
        return Promise.resolve();
      },
    });

    // The claim is the at-most-once guard, so nothing is sent again — but the
    // intent that earlier run left behind is closed out rather than stranded.
    expect(sentMessages).toEqual([]);
    expect(recorded).toEqual([
      {
        kind: "already-delivered",
        channelId,
        messageId: ALREADY_SENT_MESSAGE_ID,
        // The claim's own bracket around the send, not this pass's clock.
        send: { startedAt: CLAIMED_AT, deliveredAt: COMPLETED_AT },
      },
    ]);
    expect(delivery.messageIdsByChannel).toEqual(
      new Map([[channelId, ALREADY_SENT_MESSAGE_ID]]),
    );
  });

  test("replies to the matching prematch message per channel", async () => {
    const firstChannel = DiscordChannelIdSchema.parse("123456789012345678");
    const secondChannel = DiscordChannelIdSchema.parse("123456789012345679");

    const delivery = await deliverToChannels({
      message: { content: "Game finished" },
      channels: [
        { channel: firstChannel, serverId: "123456789012345680" },
        { channel: secondChannel, serverId: "123456789012345680" },
      ],
      logPrefix: "[test]",
      sentryTags: {},
      replyToMessageIds: new Map([[firstChannel, "prematch-first"]]),
    });

    expect(sentMessages).toEqual([
      {
        content: "Game finished",
        reply: {
          messageReference: "prematch-first",
          failIfNotExists: false,
        },
      },
      { content: "Game finished" },
    ]);
    expect(delivery.deliveredGuildIds).toEqual(
      new Set([DiscordGuildIdSchema.parse("123456789012345680")]),
    );
    expect(delivery.messageIdsByChannel).toEqual(
      new Map([
        [firstChannel, "sent-message-1"],
        [secondChannel, "sent-message-2"],
      ]),
    );
  });

  test("retries as a normal message when the reply permission is missing", async () => {
    failReplyOnce = true;
    const channelId = DiscordChannelIdSchema.parse("123456789012345678");

    await deliverToChannels({
      message: { content: "Game finished" },
      channels: [{ channel: channelId, serverId: "123456789012345680" }],
      logPrefix: "[test]",
      sentryTags: {},
      replyToMessageIds: new Map([[channelId, "prematch-message"]]),
    });

    expect(sentMessages).toEqual([{ content: "Game finished" }]);
  });

  test("does not return a guild when every channel delivery fails", async () => {
    failAll = true;
    const channelId = DiscordChannelIdSchema.parse("123456789012345678");

    const delivery = await deliverToChannels({
      message: { content: "Game finished" },
      channels: [{ channel: channelId, serverId: "123456789012345680" }],
      logPrefix: "[test]",
      sentryTags: {},
    });

    expect(delivery.deliveredGuildIds).toEqual(new Set());
    expect(delivery.messageIdsByChannel).toEqual(new Map());
  });
});
