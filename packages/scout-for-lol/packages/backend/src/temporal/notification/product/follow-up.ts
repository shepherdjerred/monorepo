import {
  BucksWeeklyLeaderboardEntriesSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { settleProductAnnouncementBudget } from "#src/temporal/notification/product/budget.ts";
import {
  notificationIntentRowToRecord,
  type ProductNotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";
import {
  productAnnouncementOf,
  productAnnouncementIntentKey,
} from "#src/temporal/notification/product/announcement.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import { recordCoreOutputDelivered } from "#src/analytics/guild-lifecycle.ts";

async function publishWeeklyStandings(
  db: Db,
  publicationId: string,
): Promise<void> {
  const publication = await db.bucksWeeklyPublication.findUniqueOrThrow({
    where: { id: publicationId },
  });
  if (publication.publishedAt !== null) return;
  const keys = Array.from({ length: publication.chunkCount }, (_, index) =>
    productAnnouncementIntentKey(
      `${publication.id}:chunk:${index.toString()}`,
      {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(COMMON_DENOMINATOR_CHANNEL_ID),
      },
    ),
  );
  const delivered = await db.matchNotificationIntent.count({
    where: { intentKey: { in: keys }, state: "delivered" },
  });
  if (delivered !== publication.chunkCount) return;
  const entries = BucksWeeklyLeaderboardEntriesSchema.parse(
    JSON.parse(publication.entries),
  );
  const serverId = DiscordGuildIdSchema.parse(publication.serverId);
  await db.bucksWeeklyLeaderboardSnapshot.upsert({
    where: { serverId_runWeek: { serverId, runWeek: publication.runWeek } },
    create: {
      serverId,
      runWeek: publication.runWeek,
      entryCount: entries.length,
      entries: publication.entries,
    },
    update: {},
  });
  await db.bucksWeeklyPublication.updateMany({
    where: { id: publication.id, publishedAt: null },
    data: { publishedAt: new Date() },
  });
}

/** All required bookkeeping and its completion marker commit together. */
export async function afterProductAnnouncementDelivered(
  record: ProductNotificationIntentRecord,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const completed = await database.$transaction(async (db) => {
    await db.$queryRaw`SELECT "intentKey" FROM "MatchNotificationIntent" WHERE "intentKey" = ${record.intent.key} FOR UPDATE`;
    const stored = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: record.intent.key },
    });
    if (stored.state !== "delivered" || stored.followUpCompletedAt !== null)
      return false;
    const { effect } = productAnnouncementOf(record);
    switch (effect.kind) {
      case "competition":
        if (effect.phase === "start")
          await db.competition.update({
            where: { id: effect.competitionId },
            data: {
              startNotifiedAt: stored.deliveredAt,
              startNotificationMessageId: stored.messageId,
            },
          });
        if (effect.phase === "end")
          await db.competition.update({
            where: { id: effect.competitionId },
            data: {
              endNotifiedAt: stored.deliveredAt,
              endNotificationMessageId: stored.messageId,
            },
          });
        break;
      case "weekly-bucks":
        await publishWeeklyStandings(db, effect.publicationId);
        break;
      case "customs-recruitment":
        if (stored.messageId === null)
          throw new Error(
            "A delivered recruitment announcement needs its message ID",
          );
        await db.customNight.updateMany({
          where: {
            id: effect.nightId,
            recruitmentGeneration: effect.generation,
            recruitmentMessageId: null,
          },
          data: {
            recruitmentMessageId: stored.messageId,
            revision: { increment: 1 },
          },
        });
        break;
      case "outreach":
        await db.dmAuditLog.update({
          where: { id: effect.auditId },
          data: { deliveryStatus: "sent" },
        });
        break;
      case "offline-recovery":
        // The notice has no domain row to stamp; delivery is the whole effect.
        break;
    }
    await db.matchNotificationIntent.update({
      where: { intentKey: record.intent.key },
      data: { followUpCompletedAt: new Date() },
    });
    return true;
  });
  const { effect, guildId } = productAnnouncementOf(record);
  if (completed && effect.kind === "competition")
    await recordCoreOutputDelivered(
      guildId,
      effect.phase === "start"
        ? "competition_started"
        : effect.phase === "end"
          ? "competition_ended"
          : "competition_leaderboard",
      { db: database },
    );
}

/** The existing reconciliation Schedule repairs exhausted post-send attempts. */
export async function repairProductAnnouncementFollowUps(
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const rows = await database.matchNotificationIntent.findMany({
    where: {
      kind: "product-announcement",
      state: {
        in: ["delivered", "expired", "suppressed", "permission-denied"],
      },
      followUpCompletedAt: null,
    },
    orderBy: [{ deliveredAt: "asc" }, { intentKey: "asc" }],
    take: 100,
  });
  const failures: unknown[] = [];
  for (const row of rows) {
    try {
      const record = notificationIntentRowToRecord(row);
      if (!("announcementId" in record))
        throw new Error(
          `Announcement ${NotificationIntentKeySchema.parse(row.intentKey)} has another subject`,
        );
      if (record.intent.state.kind === "delivered")
        await afterProductAnnouncementDelivered(record, database);
      else
        await database.$transaction(async (db) => {
          await settleProductAnnouncementBudget(db, record.intent.key);
          await db.matchNotificationIntent.updateMany({
            where: {
              intentKey: record.intent.key,
              state: { in: ["expired", "suppressed", "permission-denied"] },
              followUpCompletedAt: null,
            },
            data: { followUpCompletedAt: new Date() },
          });
        });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Product announcement bookkeeping needs repair",
    );
}
