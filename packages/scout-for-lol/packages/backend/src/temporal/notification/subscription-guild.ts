import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

export async function subscriptionGuildOfChannel(
  channelId: DiscordChannelId,
  database: ExtendedPrismaClient = prisma,
): Promise<DiscordGuildId | null> {
  const subscription = await database.subscription.findFirst({
    where: { channelId: DiscordChannelIdSchema.parse(channelId) },
    select: { serverId: true },
  });
  return subscription === null
    ? null
    : DiscordGuildIdSchema.parse(subscription.serverId);
}
