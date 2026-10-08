import type { MessageCreateOptions } from "discord.js";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { DareNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { getBucksNotificationPreferences } from "#src/betting/notify/notification-preferences.ts";
import {
  dareStatusAnnouncementCodec,
  renderDareStatus,
} from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import { renderDareResult } from "#src/betting/dares/presentation/dare-callout-content.ts";
import { refreshDareCallout } from "#src/betting/dares/presentation/dare-callout.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/notification/announcement-codecs.ts";

export function dareStatusAnnouncementOf(record: DareNotificationIntentRecord) {
  const { intent } = record;
  if (intent.kind !== "dare-status" || intent.announcement === undefined) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "a Dare subject requires a dare-status announcement",
    });
  }
  let announcement;
  try {
    announcement = dareStatusAnnouncementCodec.parse(intent.announcement);
  } catch (error) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: `its Dare announcement does not parse (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  // A DM carries a participant's status line; the channel carries the public
  // result post, and only the channel does.
  const isResultPost = intent.target.kind === "channel";
  if (
    announcement.dareId !== record.dareId ||
    isResultPost !== (announcement.result !== undefined)
  ) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "the Dare subject or target disagrees with its announcement",
    });
  }
  return announcement;
}

export async function dareStatusSuppression(
  record: DareNotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  const announcement = dareStatusAnnouncementOf(record);
  const dare = await prisma.bucksDare.findUnique({
    where: { id: record.dareId },
    select: { serverId: true },
  });
  if (dare?.serverId !== announcement.guildId) {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "the Dare subject and guild no longer agree",
    });
  }
  if (
    !(await isPolicyEnabled("dare_notifications_enabled", {
      server: announcement.guildId,
    }))
  ) {
    return "feature-disabled";
  }
  // The public result post answers to the guild's flag alone; DM
  // preferences are about a participant's inbox, not the Dare's channel.
  if (record.intent.target.kind === "channel") return undefined;
  const preferences = await getBucksNotificationPreferences({
    serverId: announcement.guildId,
    discordId: record.intent.target.accountId,
  });
  const enabled =
    announcement.category === "lifecycle"
      ? preferences.dareLifecycleDms
      : preferences.dareProgressDms;
  return enabled ? undefined : "recipient-preference";
}

export function buildDareStatusNotificationMessage(
  record: DareNotificationIntentRecord,
): MessageCreateOptions {
  const announcement = dareStatusAnnouncementOf(record);
  if (announcement.result !== undefined) {
    const message = renderDareResult(announcement.dareId, announcement.result);
    return {
      content: message.content,
      allowedMentions: { parse: [], users: message.mentionUserIds },
    };
  }
  return {
    content: renderDareStatus(announcement),
    allowedMentions: { parse: [] },
  };
}

/**
 * Edit the Dare's callout to its final state once the result post is out.
 *
 * Runs only after Discord accepted the result post, so the channel reads in
 * order: the result, then the callout it resolves. Only a channel post has
 * one; a DM has nothing public to follow.
 */
export async function afterDareStatusDelivered(
  record: DareNotificationIntentRecord,
): Promise<"refreshed" | "skipped"> {
  if (record.intent.target.kind !== "channel") return "skipped";
  await refreshDareCallout(record.dareId);
  return "refreshed";
}
