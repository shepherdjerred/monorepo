import { beforeEach, expect, test, vi } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import { deliveryGuildId } from "#src/temporal/notification/channel-guild.ts";

const stubs = vi.hoisted(() => ({
  fetchChannelForDelivery: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: { subscription: { findMany: stubs.findMany } },
}));

const CHANNEL_ID = DiscordChannelIdSchema.parse("100000000000000001");
const GUILD_ID = DiscordGuildIdSchema.parse("100000000000000099");

beforeEach(() => {
  vi.clearAllMocks();
});

test("a channel Discord returns keeps that guild", async () => {
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: GUILD_ID });

  await expect(deliveryGuildId(CHANNEL_ID)).resolves.toBe(GUILD_ID);
  expect(stubs.findMany).not.toHaveBeenCalled();
});

test("a missing channel does not invent a guild from subscriptions", async () => {
  stubs.fetchChannelForDelivery.mockResolvedValue(null);

  await expect(deliveryGuildId(CHANNEL_ID)).resolves.toBeUndefined();
  expect(stubs.findMany).not.toHaveBeenCalled();
});

test("Missing Access uses the guild stored on the subscription", async () => {
  stubs.fetchChannelForDelivery.mockRejectedValue({
    code: 50_001,
    message: "Missing Access",
  });
  stubs.findMany.mockResolvedValue([{ serverId: GUILD_ID }]);

  await expect(deliveryGuildId(CHANNEL_ID)).resolves.toBe(GUILD_ID);
  expect(stubs.findMany).toHaveBeenCalledWith({
    where: { channelId: CHANNEL_ID },
    distinct: ["serverId"],
    select: { serverId: true },
  });
});

test("Missing Access uses the guild the caller recorded instead", async () => {
  // A product announcement channel has no subscription row; its frozen
  // announcement is the guild this delivery already knows.
  stubs.fetchChannelForDelivery.mockRejectedValue({
    code: 50_001,
    message: "Missing Access",
  });

  await expect(deliveryGuildId(CHANNEL_ID, async () => GUILD_ID)).resolves.toBe(
    GUILD_ID,
  );
  expect(stubs.findMany).not.toHaveBeenCalled();
});

test("a channel Discord returns outranks the recorded guild", async () => {
  stubs.fetchChannelForDelivery.mockResolvedValue({
    guildId: "100000000000000098",
  });

  await expect(deliveryGuildId(CHANNEL_ID, async () => GUILD_ID)).resolves.toBe(
    "100000000000000098",
  );
});

test("a fetch timeout stays a failure", async () => {
  stubs.fetchChannelForDelivery.mockRejectedValue(new Error("rest 500"));

  await expect(deliveryGuildId(CHANNEL_ID)).rejects.toThrow("rest 500");
  expect(stubs.findMany).not.toHaveBeenCalled();
});
