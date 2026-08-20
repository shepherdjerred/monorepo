import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import type { MessageCreateOptions } from "discord.js";
import type {
  SubscribedChannel,
  SubscribedChannelSubscription,
} from "#src/database/index.ts";

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

await mock.module("#src/league/discord/channel.ts", () => ({
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
