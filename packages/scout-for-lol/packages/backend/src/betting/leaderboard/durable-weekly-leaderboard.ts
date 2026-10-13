import {
  BucksWeeklyLeaderboardEntriesSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import {
  formatWeeklyBucksLeaderboard,
  rankBucksLeaderboard,
} from "#src/betting/leaderboard/weekly-format.ts";
import type {
  WeeklyBucksLeaderboardDependencies,
  WeeklyBucksLeaderboardResult,
} from "#src/betting/leaderboard/weekly-contracts.ts";
import { mintProductAnnouncement } from "#src/temporal/notification/product/announcement.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function queueDurableWeeklyLeaderboard(
  dependencies: WeeklyBucksLeaderboardDependencies,
  serverId: DiscordGuildId,
  occurredAt: Date,
  database: ExtendedPrismaClient = prisma,
): Promise<WeeklyBucksLeaderboardResult> {
  const runWeek = Math.floor(occurredAt.getTime() / WEEK_MS);
  const id = `weekly-bucks:${serverId}:${runWeek.toString()}`;
  const standing = await database.bucksWeeklyPublication.findUnique({
    where: { id },
  });
  if (standing !== null)
    return {
      status: standing.publishedAt === null ? "queued" : "sent",
      entryCount: BucksWeeklyLeaderboardEntriesSchema.parse(
        JSON.parse(standing.entries),
      ).length,
      chunkCount: standing.chunkCount,
    };
  const legacy = await database.bucksWeeklyLeaderboardSnapshot.findUnique({
    where: { serverId_runWeek: { serverId, runWeek } },
  });
  if (legacy !== null)
    return {
      status: "sent",
      entryCount: legacy.entryCount,
      chunkCount: 0,
    };
  const rows = await dependencies.loadRows(serverId);
  const stats = await dependencies.loadStats(
    serverId,
    new Date(occurredAt.getTime() - WEEK_MS),
  );
  const chunks = formatWeeklyBucksLeaderboard(rows, stats);
  const entries = BucksWeeklyLeaderboardEntriesSchema.parse(
    rankBucksLeaderboard(rows).map((row) => ({
      rank: row.rank,
      discordId: row.discordId,
      balance: row.balance,
    })),
  );
  await database.$transaction(async (db) => {
    const created = await db.bucksWeeklyPublication.createMany({
      data: [
        {
          id,
          serverId,
          runWeek,
          entries: JSON.stringify(entries),
          chunkCount: chunks.length,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return;
    for (const [index, chunk] of chunks.entries())
      await mintProductAnnouncement(db, {
        announcementId: `${id}:chunk:${index.toString()}`,
        guildId: serverId,
        target: { kind: "channel", channelId: COMMON_DENOMINATOR_CHANNEL_ID },
        message: { content: chunk },
        effect: { kind: "weekly-bucks", publicationId: id },
        occurredAt,
        freshnessDeadline: new Date(occurredAt.getTime() + FRESHNESS_MS),
      });
  });
  const saved = await database.bucksWeeklyPublication.findUniqueOrThrow({
    where: { id },
  });
  return {
    status: "queued",
    entryCount: BucksWeeklyLeaderboardEntriesSchema.parse(
      JSON.parse(saved.entries),
    ).length,
    chunkCount: saved.chunkCount,
  };
}
