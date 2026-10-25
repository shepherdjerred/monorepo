import type {
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { isPermissionError } from "#src/discord/utils/permissions.ts";

/**
 * The guild a notification channel already belongs to in our own records.
 *
 * Discord answers Missing Access by throwing from the channel fetch, so the
 * read that was supposed to learn the guild never returns one. The
 * subscription row is that guild. The send path needs it: the owner DM is
 * sent only when the delivery knows which server lost access. No row means
 * there is nobody stored to tell. Two guilds for one channel cannot happen
 * for a real Discord channel, so that data is a broken contract.
 */
export async function subscribedGuildId(
  channelId: DiscordChannelId,
  database: ExtendedPrismaClient = prisma,
): Promise<DiscordGuildId | undefined> {
  const rows = await database.subscription.findMany({
    where: { channelId },
    distinct: ["serverId"],
    select: { serverId: true },
  });
  if (rows.length === 0) return;
  if (rows.length !== 1) {
    throw new Error(
      `Channel ${channelId} has subscriptions in ${String(rows.length)} guilds`,
    );
  }
  const serverId = rows[0]?.serverId;
  if (serverId === undefined) {
    throw new Error(`Channel ${channelId} subscription is missing its guild`);
  }
  return DiscordGuildIdSchema.parse(serverId);
}

/**
 * Guild to hand `send` so a permission refusal can DM that server's owner.
 *
 * A channel Discord returns is authoritative. Missing Access throws instead
 * of returning one; the subscription is then the guild we already know.
 * Any other fetch failure stays a failure, because a timeout is not a
 * permission refusal and must stay retryable.
 */
export async function deliveryGuildId(
  channelId: DiscordChannelId,
  database: ExtendedPrismaClient = prisma,
): Promise<DiscordGuildId | undefined> {
  try {
    const channel = await fetchChannelForDelivery(channelId);
    if (channel === null) return;
    const guildId: unknown = "guildId" in channel ? channel.guildId : undefined;
    const parsed = DiscordGuildIdSchema.safeParse(guildId);
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    return await subscribedGuildId(channelId, database);
  }
}
