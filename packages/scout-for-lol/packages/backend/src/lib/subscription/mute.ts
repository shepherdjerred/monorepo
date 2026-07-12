import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type {
  SetSubscriptionMutedInput,
  SetSubscriptionMutedResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-mute");

/**
 * Mute (or unmute) a single subscription, identified by player alias + channel
 * within a guild. Muted subscriptions are skipped by pre/post-match
 * notification dispatch but otherwise stay intact. The caller owns the
 * transaction.
 */
export async function setSubscriptionMuted(
  input: SetSubscriptionMutedInput,
  db: Db,
): Promise<SetSubscriptionMutedResult> {
  const { guildId, channelId, alias, isMuted } = input;

  try {
    const player = await db.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias } },
      include: { subscriptions: true },
    });
    if (!player) {
      return { kind: "player-not-found" };
    }

    const subscription = player.subscriptions.find(
      (s) => s.channelId === channelId,
    );
    if (!subscription) {
      return { kind: "not-subscribed-in-channel" };
    }

    await db.subscription.update({
      where: { id: subscription.id },
      data: { isMuted, updatedTime: new Date() },
    });

    logger.info(
      `✅ ${isMuted ? "Muted" : "Unmuted"} "${alias}" in ${channelId}`,
    );
    return { kind: "updated" };
  } catch (error) {
    logger.error("❌ Error setting subscription mute state:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
