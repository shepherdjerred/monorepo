import type { InteractionReplyOptions } from "discord.js";
import type { PlayerWithSubscriptions } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";

/**
 * Format a list of player accounts for display
 */
export function formatPlayerAccountsList(
  player: NonNullable<PlayerWithSubscriptions>,
): string {
  return player.accounts
    .map((acc) => `• ${acc.alias} (${acc.region})`)
    .join("\n");
}

/**
 * Format a list of player subscriptions for display
 * Returns formatted list or "No active subscriptions." if empty
 */
export function formatPlayerSubscriptionsList(
  player: NonNullable<PlayerWithSubscriptions>,
): string {
  if (player.subscriptions.length === 0) {
    return "No active subscriptions.";
  }
  return player.subscriptions.map((sub) => `<#${sub.channelId}>`).join(", ");
}

/**
 * Build a success response for player update operations
 * Includes formatted accounts and subscriptions lists
 */
export function buildPlayerUpdateResponse(
  player: NonNullable<PlayerWithSubscriptions>,
  title: string,
  details: string,
): InteractionReplyOptions {
  const accountsList = formatPlayerAccountsList(player);
  const subscriptionsList = formatPlayerSubscriptionsList(player);

  return {
    content: `${title}\n\n${details}\n\n**Accounts (${player.accounts.length.toString()}):**\n${accountsList}\n\n**Subscribed channels:** ${subscriptionsList}`,
    ephemeral: true,
  };
}
