import { serializeSubscriptionFilters } from "@scout-for-lol/data/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/lib/audit/index.ts";
import type {
  SetChannelFiltersInput,
  SetChannelFiltersResult,
  SetSubscriptionFiltersInput,
  SetSubscriptionFiltersResult,
} from "#src/lib/subscription/types.ts";

const logger = createLogger("subscription-filters");

/**
 * Set (or clear, when `filters` is null) the notification filters for a single
 * subscription, identified by player alias + channel within a guild. The caller
 * owns the transaction.
 */
export async function setSubscriptionFilters(
  input: SetSubscriptionFiltersInput,
  db: Db,
): Promise<SetSubscriptionFiltersResult> {
  const { guildId, channelId, alias, filters } = input;

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
      data: {
        filters: filters ? serializeSubscriptionFilters(filters) : null,
        updatedTime: new Date(),
      },
    });

    logger.info(
      `✅ Set filters for "${alias}" in ${channelId} (${filters ? "applied" : "cleared"})`,
    );
    return { kind: "updated" };
  } catch (error) {
    logger.error("❌ Error setting subscription filters:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}

/**
 * Bulk set (or clear) the notification filters for EVERY subscription in a
 * channel within a guild. Powers the web "set all subs in this channel" action.
 * The caller owns the transaction.
 */
export async function setChannelFilters(
  input: SetChannelFiltersInput,
  db: Db,
): Promise<SetChannelFiltersResult> {
  const { guildId, channelId, filters } = input;

  try {
    const serialized = filters ? serializeSubscriptionFilters(filters) : null;
    const result = await db.subscription.updateMany({
      where: { serverId: guildId, channelId },
      data: { filters: serialized, updatedTime: new Date() },
    });

    logger.info(
      `✅ Bulk-set filters for ${result.count.toString()} subscriptions in ${channelId} (${filters ? "applied" : "cleared"})`,
    );
    return { kind: "updated", count: result.count };
  } catch (error) {
    logger.error("❌ Error bulk-setting channel filters:", error);
    return { kind: "internal-error", message: getErrorMessage(error) };
  }
}
