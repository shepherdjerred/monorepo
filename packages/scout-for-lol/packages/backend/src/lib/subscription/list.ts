import { prisma } from "#src/database/index.ts";
import type {
  ListSubscriptionsInput,
  SubscriptionListItem,
} from "#src/lib/subscription/types.ts";

export async function listSubscriptions(
  input: ListSubscriptionsInput,
): Promise<SubscriptionListItem[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { serverId: input.guildId },
    include: {
      player: { include: { accounts: true } },
    },
    orderBy: [{ channelId: "asc" }, { createdTime: "asc" }],
  });

  return subscriptions.map((sub) => ({
    subscriptionId: sub.id,
    channelId: sub.channelId,
    player: {
      id: sub.player.id,
      alias: sub.player.alias,
      discordId: sub.player.discordId,
      accounts: sub.player.accounts.map((a) => ({
        id: a.id,
        alias: a.alias,
        region: a.region,
        puuid: a.puuid,
      })),
    },
    creatorDiscordId: sub.creatorDiscordId,
    createdTime: sub.createdTime,
  }));
}
