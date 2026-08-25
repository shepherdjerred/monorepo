import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import {
  getBucksNotificationPreferences,
  updateBucksNotificationPreferences,
  type BucksNotificationPreferenceUpdates,
  type BucksNotificationPreferences,
} from "#src/betting/notification-preferences.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";

export type BbNotificationCommandDependencies = {
  getNotificationPreferences?: typeof getBucksNotificationPreferences;
  updateNotificationPreferences?: typeof updateBucksNotificationPreferences;
};

function notificationToggle(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "on") return true;
  if (value === "off") return false;
  throw new Error(`Unknown notification toggle: ${value}`);
}

function notificationStatusLine(label: string, enabled: boolean): string {
  return `${label}: **${enabled ? "On" : "Off"}**`;
}

export function formatBucksNotificationPreferences(
  preferences: BucksNotificationPreferences,
  updates: BucksNotificationPreferenceUpdates,
): string {
  const changed = [
    updates.ownBetSettlementDms === undefined
      ? undefined
      : `your bets ${updates.ownBetSettlementDms ? "on" : "off"}`,
    updates.betsOnPlayerSettlementDms === undefined
      ? undefined
      : `bets on you ${updates.betsOnPlayerSettlementDms ? "on" : "off"}`,
  ].filter((value) => value !== undefined);
  return [
    "🔔 **Bryan Bucks notifications**",
    notificationStatusLine("Bets I placed", preferences.ownBetSettlementDms),
    notificationStatusLine(
      "Bets other users placed on me",
      preferences.betsOnPlayerSettlementDms,
    ),
    changed.length === 0
      ? "Use `your_bets` or `bets_on_you` with `on` or `off` to change these settings."
      : `Updated: ${changed.join(", ")}.`,
  ].join("\n");
}

export async function replyBbNotifications(
  interaction: BbCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  dependencies: BbNotificationCommandDependencies,
): Promise<void> {
  const ownBetSettlementDms = notificationToggle(
    interaction.options.getString("your_bets"),
  );
  const betsOnPlayerSettlementDms = notificationToggle(
    interaction.options.getString("bets_on_you"),
  );
  const updates: BucksNotificationPreferenceUpdates = {
    ...(ownBetSettlementDms === undefined ? {} : { ownBetSettlementDms }),
    ...(betsOnPlayerSettlementDms === undefined
      ? {}
      : { betsOnPlayerSettlementDms }),
  };
  const preferences =
    ownBetSettlementDms === undefined && betsOnPlayerSettlementDms === undefined
      ? await (
          dependencies.getNotificationPreferences ??
          getBucksNotificationPreferences
        )({ serverId, discordId })
      : await (
          dependencies.updateNotificationPreferences ??
          updateBucksNotificationPreferences
        )({
          serverId,
          discordId,
          updates,
        });
  await interaction.editReply({
    content: formatBucksNotificationPreferences(preferences, updates),
  });
}
