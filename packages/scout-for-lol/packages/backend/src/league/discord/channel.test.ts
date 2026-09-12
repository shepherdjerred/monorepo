import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Channel } from "discord.js";

/**
 * The shared sender, exercised on a process that owns no Discord gateway.
 *
 * The client is mocked rather than a fake being injected because that is the
 * shape of the bug: `send` reaches for the singleton, and on the `application`
 * and `activity-worker` roles that singleton has a REST token and permanently
 * empty caches. The fetch below emulates the discord.js rule exactly — a guild
 * channel is only returned when the caller allowed an unknown guild — so a
 * default fetch here returns `null` for a live channel and every background
 * delivery classifies it as deleted.
 */
const discord = vi.hoisted(() => ({ fetchChannel: vi.fn() }));

vi.mock("#src/discord/client.ts", () => ({
  client: { channels: { fetch: discord.fetchChannel } },
}));

const { ChannelSendError, send } =
  await import("#src/league/discord/channel.ts");
const { discordPermissionErrorsTotal } = await import("#src/metrics/index.ts");
const { mockMessage, mockTextChannel } =
  await import("#src/testing/discord-mocks.ts");
const { testChannelId } = await import("#src/testing/test-ids.ts");

const CHANNEL_ID = testChannelId("1");

type FetchOptions = { allowUnknownGuild?: boolean };

/**
 * A channel as the gatewayless roles receive it: no guild, so every permission
 * accessor throws instead of answering.
 */
function guildlessChannel(overrides: Record<string, unknown> = {}): Channel {
  return mockTextChannel({
    guild: undefined,
    permissionsFor: () => {
      throw new TypeError("Cannot read properties of undefined (reading 'id')");
    },
    ...overrides,
  });
}

function resolveOnlyForUnknownGuild(channel: Channel): void {
  discord.fetchChannel.mockImplementation(
    (_id: string, options: FetchOptions = {}) =>
      Promise.resolve(options.allowUnknownGuild === true ? channel : null),
  );
}

/** Total deliveries classified as `kind` for a guild we could not name. */
async function classifiedAs(kind: string): Promise<number> {
  const metric = await discordPermissionErrorsTotal.get();
  return metric.values
    .filter((sample) => sample.labels.error_type === kind)
    .reduce((total, sample) => total + sample.value, 0);
}

beforeEach(() => {
  discord.fetchChannel.mockReset();
});

describe("send on a process with an empty guild cache", () => {
  test("delivers to a channel whose guild is not cached", async () => {
    const delivered: unknown[] = [];
    const message = mockMessage();
    resolveOnlyForUnknownGuild(
      guildlessChannel({
        send: (options: unknown) => {
          delivered.push(options);
          return Promise.resolve(message);
        },
      }),
    );

    expect(await send("scheduled report", CHANNEL_ID)).toBe(message);
    expect(delivered).toEqual(["scheduled report"]);
  });

  test("delivers a reply payload instead of failing its permission preflight", async () => {
    const delivered: unknown[] = [];
    resolveOnlyForUnknownGuild(
      guildlessChannel({
        send: (options: unknown) => {
          delivered.push(options);
          return Promise.resolve(mockMessage());
        },
      }),
    );

    await send(
      { content: "weekly leaderboard", reply: { messageReference: "1" } },
      CHANNEL_ID,
    );

    expect(delivered).toHaveLength(1);
  });
});

describe("send still recognises a channel that is genuinely gone", () => {
  test("classifies an Unknown Channel (10003) rejection as missing", async () => {
    const before = await classifiedAs("channel_missing");
    discord.fetchChannel.mockRejectedValue(
      Object.assign(new Error("Unknown Channel"), { code: 10_003 }),
    );

    await expect(send("scheduled report", CHANNEL_ID)).rejects.toMatchObject({
      name: "ChannelSendError",
      permissionError: true,
    });
    expect(await classifiedAs("channel_missing")).toBe(before + 1);
  });

  test("reports a channel Discord does not return at all as unreachable", async () => {
    discord.fetchChannel.mockResolvedValue(null);

    await expect(send("scheduled report", CHANNEL_ID)).rejects.toThrow(
      ChannelSendError,
    );
  });
});

describe("send diagnoses an unclassified failure without blaming the owner", () => {
  test("leaves a guildless channel's send failure to the operator", async () => {
    const beforePermission = await classifiedAs("permission");
    const beforeMissing = await classifiedAs("channel_missing");
    resolveOnlyForUnknownGuild(
      guildlessChannel({
        send: () => Promise.reject(new Error("503 Service Unavailable")),
      }),
    );

    // `permissionError: false` is what keeps this out of the guild's delivery
    // failure streak and out of the owner's DMs: the re-fetch proved the
    // channel is there, and a channel with no guild cannot answer a permission
    // question either way.
    await expect(send("scheduled report", CHANNEL_ID)).rejects.toMatchObject({
      name: "ChannelSendError",
      permissionError: false,
    });
    expect(await classifiedAs("permission")).toBe(beforePermission);
    expect(await classifiedAs("channel_missing")).toBe(beforeMissing);
  });
});
