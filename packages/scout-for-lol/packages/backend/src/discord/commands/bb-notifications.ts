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
    updates.dareLifecycleDms === undefined
      ? undefined
      : `Dare lifecycle ${updates.dareLifecycleDms ? "on" : "off"}`,
    updates.dareProgressDms === undefined
      ? undefined
      : `Dare progress ${updates.dareProgressDms ? "on" : "off"}`,
  ].filter((value) => value !== undefined);
  return [
    "🔔 **Bryan Bucks notifications**",
    notificationStatusLine("Bets I placed", preferences.ownBetSettlementDms),
    notificationStatusLine(
      "Bets other users placed on me",
      preferences.betsOnPlayerSettlementDms,
    ),
    notificationStatusLine("Dare lifecycle", preferences.dareLifecycleDms),
    notificationStatusLine("Dare progress", preferences.dareProgressDms),
    changed.length === 0
      ? "Choose any notification option with `on` or `off` to change these settings."
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
  const dareLifecycleDms = notificationToggle(
    interaction.options.getString("dare_lifecycle"),
  );
  const dareProgressDms = notificationToggle(
    interaction.options.getString("dare_progress"),
  );
  const updates: BucksNotificationPreferenceUpdates = {
    ...(ownBetSettlementDms === undefined ? {} : { ownBetSettlementDms }),
    ...(betsOnPlayerSettlementDms === undefined
      ? {}
      : { betsOnPlayerSettlementDms }),
    ...(dareLifecycleDms === undefined ? {} : { dareLifecycleDms }),
    ...(dareProgressDms === undefined ? {} : { dareProgressDms }),
  };
  const preferences =
    ownBetSettlementDms === undefined &&
    betsOnPlayerSettlementDms === undefined &&
    dareLifecycleDms === undefined &&
    dareProgressDms === undefined
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
