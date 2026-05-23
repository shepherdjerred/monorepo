import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type {
  MoveSubscriptionInput,
  MoveSubscriptionResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-move");

export async function moveSubscription(
  input: MoveSubscriptionInput,
): Promise<MoveSubscriptionResult> {
  const { guildId, alias, fromChannelId, toChannelId } = input;

  if (fromChannelId === toChannelId) {
    return { kind: "same-channel" };
  }

  try {
    const player = await prisma.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true },
    });

    if (!player) {
      return { kind: "player-not-found" };
    }

    const sourceSubscription = player.subscriptions.find(
      (s) => s.channelId === fromChannelId,
    );
    if (!sourceSubscription) {
      return { kind: "not-subscribed-in-from-channel" };
    }

    const existingTarget = player.subscriptions.find(
      (s) => s.channelId === toChannelId,
    );
    if (existingTarget) {
      return { kind: "already-subscribed-in-to-channel" };
    }

    await prisma.subscription.update({
      where: { id: sourceSubscription.id },
      data: { channelId: toChannelId },
    });

    logger.info(
      `✅ Moved subscription for "${alias}" from ${fromChannelId} to ${toChannelId}`,
    );
    return { kind: "moved" };
  } catch (error) {
    logger.error("❌ Error moving subscription:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
