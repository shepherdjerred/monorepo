import type { MessageCreateOptions } from "discord.js";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { DuelNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { duelRolloutAllowed } from "#src/progression/duels/access.ts";
import { renderDuelStatus } from "#src/progression/duels/outbox.ts";
import { duelStatusAnnouncementCodec } from "#src/progression/duels/status-message.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/v2/notification/announcement-codecs.ts";

function announcementOf(record: DuelNotificationIntentRecord) {
  const { intent } = record;
  if (intent.kind !== "duel-status" || intent.announcement === undefined) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "a Duel subject requires a duel-status announcement",
    });
  }
  let announcement;
  try {
    announcement = duelStatusAnnouncementCodec.parse(intent.announcement);
  } catch (error) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: `its Duel announcement does not parse (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  if (announcement.payload.seriesId !== record.duelId) {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "its announced series disagrees with the Duel subject",
    });
  }
  if (intent.target.kind !== "channel") {
    throw new MalformedAnnouncementIntentError({
      intentKey: intent.key,
      detail: "Duel status must target a channel",
    });
  }
  return announcement;
}

export async function duelStatusSuppressionV2(
  record: DuelNotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  const announcement = announcementOf(record);
  return (await duelRolloutAllowed(announcement.guildId))
    ? undefined
    : "feature-disabled";
}

export async function buildDuelStatusNotificationMessageV2(
  record: DuelNotificationIntentRecord,
  deliveryGuildId: string | undefined,
): Promise<MessageCreateOptions> {
  const announcement = announcementOf(record);
  if (record.intent.target.kind !== "channel") {
    throw new Error("Duel status requires a channel target");
  }
  const series = await prisma.duelSeries.findUnique({
    where: { id: record.duelId },
    select: { guildId: true, channelId: true },
  });
  if (
    series?.guildId !== announcement.guildId ||
    series.channelId !== record.intent.target.channelId ||
    (deliveryGuildId !== undefined && deliveryGuildId !== announcement.guildId)
  ) {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "the Duel subject, guild, and channel no longer agree",
    });
  }
  const rendered = renderDuelStatus(announcement.payload, announcement.guildId);
  return {
    content: rendered.content,
    embeds: [rendered.embed],
    allowedMentions: { parse: [], users: rendered.users },
  };
}
