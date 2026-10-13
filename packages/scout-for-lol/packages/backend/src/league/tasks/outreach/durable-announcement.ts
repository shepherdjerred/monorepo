import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DmKind } from "#src/discord/utils/dm-contracts.ts";
import { reserveBudgetedDm } from "#src/discord/utils/dm-budget.ts";
import {
  mintProductAnnouncement,
  productAnnouncementIntentKey,
} from "#src/temporal/notification/product/announcement.ts";
const DAY_MS = 24 * 60 * 60 * 1000;
export async function queueOutreachAnnouncement(
  db: ExtendedPrismaClient,
  input: {
    guildId: DiscordGuildId;
    recipientId: DiscordAccountId;
    serverName: string;
    installedAt: Date;
    stage: number;
    kind: DmKind;
    message: string;
    occurredAt: Date;
  },
): Promise<"already-queued" | "queued" | "budget_exhausted" | "deferred"> {
  const { guildId, installedAt, occurredAt } = input;
  const target = { kind: "dm" as const, accountId: input.recipientId };
  const announcementId = `outreach:${guildId}:${installedAt.toISOString()}:stage:${input.stage.toString()}:day:${Math.floor(occurredAt.getTime() / DAY_MS).toString()}`;
  return await db.$transaction(async (transaction) => {
    const existing = await transaction.matchNotificationIntent.findUnique({
      where: {
        intentKey: productAnnouncementIntentKey(announcementId, target),
      },
    });
    if (existing !== null) return "already-queued";
    const reservation = await reserveBudgetedDm(transaction, {
      recipientId: input.recipientId,
      guildId,
      kind: input.kind,
      message: input.message,
      budget: {
        guildId,
        serverName: input.serverName,
        installedAt,
        ladderStage: input.stage,
      },
    });
    if (reservation.status !== "reserved") return reservation.status;
    await mintProductAnnouncement(transaction, {
      announcementId,
      guildId,
      target,
      message: { content: reservation.message },
      effect: {
        kind: "outreach",
        auditId: reservation.id,
        installedAt: IsoInstantSchema.parse(installedAt.toISOString()),
        ladderStage: input.stage,
      },
      occurredAt,
      freshnessDeadline: new Date(occurredAt.getTime() + DAY_MS),
    });
    return "queued";
  });
}
