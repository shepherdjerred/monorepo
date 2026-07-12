import { describe, expect, test } from "bun:test";
import { DiscordChannelIdSchema } from "@scout-for-lol/data";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import type {
  SubscribedChannel,
  SubscribedChannelSubscription,
} from "#src/database/index.ts";

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
    // The muted subscription has notify-all filters; the unmuted one is
    // filtered to arena only. For a solo match, nothing qualifies.
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
