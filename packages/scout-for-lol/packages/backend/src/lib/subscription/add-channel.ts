import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type {
  AddSubscriptionChannelInput,
  AddSubscriptionChannelResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-add-channel");

export async function addSubscriptionChannel(
  input: AddSubscriptionChannelInput,
): Promise<AddSubscriptionChannelResult> {
  const { guildId, alias, channelId, actorDiscordId } = input;

  try {
    const player = await prisma.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true },
    });

    if (!player) {
      return { kind: "player-not-found" };
    }

    const existing = player.subscriptions.find(
      (s) => s.channelId === channelId,
    );
    if (existing) {
      return { kind: "already-subscribed", channelId };
    }

    const now = new Date();
    await prisma.subscription.create({
      data: {
        playerId: player.id,
        channelId,
        serverId: guildId,
        creatorDiscordId: actorDiscordId,
        createdTime: now,
        updatedTime: now,
      },
    });

    logger.info(`✅ Added subscription for "${alias}" to channel ${channelId}`);

    return {
      kind: "added",
      allChannelIds: [
        ...player.subscriptions.map((s) => s.channelId),
        channelId,
      ],
    };
  } catch (error) {
    logger.error("❌ Error adding subscription channel:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
