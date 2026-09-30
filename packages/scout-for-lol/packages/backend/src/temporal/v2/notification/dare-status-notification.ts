import type { MessageCreateOptions } from "discord.js";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { DareNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { getBucksNotificationPreferences } from "#src/betting/notify/notification-preferences.ts";
import {
  dareStatusAnnouncementCodec,
  renderDareStatus,
} from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/v2/notification/announcement-codecs.ts";

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
  if (announcement.dareId !== record.dareId || intent.target.kind !== "dm") {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "the Dare subject or DM target disagrees with its announcement",
    });
  }
  return announcement;
}

export async function dareStatusSuppressionV2(
  record: DareNotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  const announcement = dareStatusAnnouncementOf(record);
  const dare = await prisma.bucksDareV2.findUnique({
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
  if (record.intent.target.kind !== "dm") {
    throw new Error("Dare status requires a DM target");
  }
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

export function buildDareStatusNotificationMessageV2(
  record: DareNotificationIntentRecord,
): MessageCreateOptions {
  const announcement = dareStatusAnnouncementOf(record);
  return {
    content: renderDareStatus(announcement),
    allowedMentions: { parse: [] },
  };
}
