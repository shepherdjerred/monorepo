import { describe, expect, test } from "vitest";
import type { Channel, Client } from "discord.js";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { mockClient, mockTextChannel } from "#src/testing/discord-mocks.ts";
import { testChannelId } from "#src/testing/test-ids.ts";

const CHANNEL_ID = testChannelId("1");

type FetchOptions = { allowUnknownGuild?: boolean };

/**
 * A client with no gateway, and therefore an empty guild cache.
 *
 * This reproduces the discord.js rule the whole helper exists for: the REST
 * lookup happens either way, but the channel is only handed back if the caller
 * allowed an unknown guild. Without that, a live channel on the `application` /
 * `activity-worker` roles is indistinguishable from a deleted one.
 */
function gatewaylessClient(channel: Channel, seen: FetchOptions[]): Client {
  return mockClient({
    guilds: { cache: new Map() },
    channels: {
      cache: new Map(),
      fetch: (_id: string, options: FetchOptions = {}) => {
        seen.push(options);
        return Promise.resolve(
          options.allowUnknownGuild === true ? channel : null,
        );
      },
    },
  });
}

describe("fetchChannelForDelivery", () => {
  test("resolves a channel whose guild is not in cache", async () => {
    const seen: FetchOptions[] = [];
    const channel = mockTextChannel({ guild: undefined });

    const resolved = await fetchChannelForDelivery(
      CHANNEL_ID,
      gatewaylessClient(channel, seen),
    );

    expect(resolved).toBe(channel);
    expect(seen).toEqual([{ allowUnknownGuild: true }]);
  });

  test("still resolves null when Discord has no such channel", async () => {
    const client = mockClient({
      channels: { cache: new Map(), fetch: () => Promise.resolve(null) },
    });

    expect(await fetchChannelForDelivery(CHANNEL_ID, client)).toBeNull();
  });

  test("propagates an Unknown Channel rejection to the caller", async () => {
    const client = mockClient({
      channels: {
        cache: new Map(),
        fetch: () =>
          Promise.reject(
            Object.assign(new Error("Unknown Channel"), { code: 10_003 }),
          ),
      },
    });

    await expect(fetchChannelForDelivery(CHANNEL_ID, client)).rejects.toThrow(
      "Unknown Channel",
    );
  });
});
