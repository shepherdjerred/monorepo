import {
  EmbedBuilder,
  escapeMarkdown,
  type MessageCreateOptions,
} from "discord.js";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { DuelNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { duelRolloutAllowed } from "#src/progression/duels/access.ts";
import { getDashboardUrl } from "#src/discord/commands/links.ts";
import {
  duelStatusAnnouncementCodec,
  type DuelStatusPayload,
} from "#src/progression/duels/status-message.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/notification/announcement-codecs.ts";

/** The Duel status copy: an embed plus the participants it may mention. */
function renderDuelStatus(payload: DuelStatusPayload, guildId: string) {
  const path = new URL(
    `duels/${guildId}/series/${payload.seriesId}`,
    getDashboardUrl(),
  ).toString();
  if (payload.kind === "code_ready") {
    return {
      content: "",
      embed: new EmbedBuilder()
        .setTitle("Duel lobby ready")
        .setDescription(
          `Game ${payload.gameNumber.toString()} is ready. Either participant can create an ordinary custom lobby; Scout Client will observe it. See the [Scout web app](${path}) for the rules.`,
        )
        .setColor(0x57_f2_87),
      users: [],
    };
  }
  const mentions = payload.mentionDiscordIds.map((id) => `<@${id}>`).join(" ");
  return {
    content: mentions,
    embed: new EmbedBuilder()
      .setTitle(
        payload.kind === "overdue" ? "Duel series overdue" : "Duel challenge",
      )
      .setDescription(
        payload.kind === "overdue"
          ? `The match window expired without an automatic result. An organizer must choose replay, no-contest, or advancement with a reason in the [Scout web app](${path}).`
          : `A new duel needs participant acceptance in the [Scout web app](${path}).`,
      )
      .setFooter({ text: escapeMarkdown(payload.seriesId) })
      .setColor(payload.kind === "overdue" ? 0xed_42_45 : 0x58_65_f2),
    users: payload.mentionDiscordIds,
  };
}

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

export async function duelStatusSuppression(
  record: DuelNotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  const announcement = announcementOf(record);
  return (await duelRolloutAllowed(announcement.guildId))
    ? undefined
    : "feature-disabled";
}

export async function buildDuelStatusNotificationMessage(
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
