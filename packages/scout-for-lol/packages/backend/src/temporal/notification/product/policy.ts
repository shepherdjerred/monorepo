import type { ProductNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { prisma } from "#src/database/index.ts";
import {
  productAnnouncementOf,
  type ProductAnnouncementEffect,
} from "#src/temporal/notification/product/announcement.ts";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
type Suppression = NotificationPolicySuppressionReason | undefined;

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
    case "customs-recruitment":
      // Customs live nights were retired with the Discord Activity. Retained
      // recruitment intents still parse, but none may announce a night.
      return "feature-disabled";
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
