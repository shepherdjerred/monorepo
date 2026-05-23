import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type {
  RemoveSubscriptionInput,
  RemoveSubscriptionResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-remove");

export async function removeSubscription(
  input: RemoveSubscriptionInput,
): Promise<RemoveSubscriptionResult> {
  const { guildId, channelId, alias } = input;

  try {
    const player = await prisma.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true, accounts: true },
    });

    if (!player) {
      return { kind: "player-not-found" };
    }

    const subscription = await prisma.subscription.findUnique({
      where: {
        serverId_playerId_channelId: {
          serverId: guildId,
          playerId: player.id,
          channelId,
        },
      },
    });

    if (!subscription) {
      return {
        kind: "not-subscribed-in-channel",
        otherChannelIds: player.subscriptions
          .filter((s) => s.channelId !== channelId)
          .map((s) => s.channelId),
      };
    }

    await prisma.subscription.delete({ where: { id: subscription.id } });
    logger.info(`✅ Removed subscription ID ${subscription.id.toString()}`);

    const remainingChannelIds = player.subscriptions
      .filter((s) => s.id !== subscription.id)
      .map((s) => s.channelId);

    return {
      kind: "removed",
      remainingChannelIds,
      accountsKept: player.accounts.map((a) => ({
        alias: a.alias,
        region: a.region,
      })),
    };
  } catch (error) {
    logger.error("❌ Error during subscription removal:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
