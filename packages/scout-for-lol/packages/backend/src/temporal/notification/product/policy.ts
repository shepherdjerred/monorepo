import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import type { ProductNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  productAnnouncementOf,
  type ProductAnnouncementEffect,
} from "#src/temporal/notification/product/announcement.ts";
type Suppression = NotificationPolicySuppressionReason | undefined;

async function recruitmentSuppression(
  record: ProductNotificationIntentRecord,
  effect: Extract<ProductAnnouncementEffect, { kind: "customs-recruitment" }>,
  guildId: DiscordGuildId,
): Promise<Suppression> {
  if (!(await isPolicyEnabled("custom_nights_enabled", { server: guildId })))
    return "feature-disabled";
  const night = await prisma.customNight.findUnique({
    where: { id: effect.nightId },
  });
  if (night === null || night.state === "ENDED") return "recipient-preference";
  if (
    night.recruitmentGeneration !== effect.generation ||
    night.recruitmentMessageId !== null
  )
    return "recipient-preference";
  if (
    night.guildId !== guildId ||
    record.intent.target.kind !== "channel" ||
    night.launchChannelId !== record.intent.target.channelId
  )
    throw new Error("Recruitment announcement disagrees with its night");
  return undefined;
}

async function competitionSuppression(
  record: ProductNotificationIntentRecord,
  effect: Extract<ProductAnnouncementEffect, { kind: "competition" }>,
  guildId: DiscordGuildId,
): Promise<Suppression> {
  const competition = await prisma.competition.findUnique({
    where: { id: effect.competitionId },
  });
  if (competition === null || competition.isCancelled)
    return "recipient-preference";
  return competition.serverId !== guildId ||
    record.intent.target.kind !== "channel" ||
    competition.channelId !== record.intent.target.channelId
    ? "recipient-preference"
    : undefined;
}

export async function productAnnouncementSuppression(
  record: ProductNotificationIntentRecord,
  deliveryGuildId?: DiscordGuildId,
): Promise<Suppression> {
  const announcement = productAnnouncementOf(record);
  if (deliveryGuildId !== undefined && deliveryGuildId !== announcement.guildId)
    throw new Error(
      `Product announcement ${record.intent.key} resolved to another guild`,
    );
  const { effect, guildId } = announcement;
  const install = await prisma.guildInstall.findUnique({
    where: { serverId: guildId },
  });
  if (
    install !== null &&
    (install.removedAt !== null ||
      install.installedAt.getTime() > Date.parse(record.intent.createdAt))
  )
    return "recipient-preference";
  switch (effect.kind) {
    case "weekly-bucks":
      return (await isPolicyEnabled("betting_enabled", { server: guildId }))
        ? undefined
        : "feature-disabled";
    case "customs-recruitment":
      return await recruitmentSuppression(record, effect, guildId);
    case "competition":
      return await competitionSuppression(record, effect, guildId);
    case "outreach":
      return install?.installedAt.toISOString() === effect.installedAt
        ? undefined
        : "recipient-preference";
    case "offline-recovery":
      // Owed to every subscribed channel, as v1's notice was; the install
      // check above already withholds it from a guild Scout has left.
      return undefined;
  }
}
