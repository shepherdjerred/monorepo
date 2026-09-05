import {
  BucksWeeklyLeaderboardEntriesSchema,
  type BucksWeeklyLeaderboardEntries,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * The persisted record of one Friday leaderboard post.
 *
 * The weekly Discord post is the only balance disclosure Bryan Bucks makes, so
 * the web leaderboard shows exactly what that post said rather than recomputing
 * live standings — a reconstruction at an idealized cutoff could contradict the
 * pinned channel message whenever a settlement lands between the cutoff and the
 * cron actually loading rows.
 */
export type WeeklyLeaderboardSnapshot = {
  postedAt: Date;
  entries: BucksWeeklyLeaderboardEntries;
};

/** Upsert one week's standings; a cron retry overwrites its own week. */
export async function saveWeeklyLeaderboardSnapshot(
  input: {
    serverId: DiscordGuildId;
    runWeek: number;
    entries: BucksWeeklyLeaderboardEntries;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const entries = JSON.stringify(
    BucksWeeklyLeaderboardEntriesSchema.parse(input.entries),
  );
  await prismaClient.bucksWeeklyLeaderboardSnapshot.upsert({
    where: {
      serverId_runWeek: { serverId: input.serverId, runWeek: input.runWeek },
    },
    create: {
      serverId: input.serverId,
      runWeek: input.runWeek,
      entryCount: input.entries.length,
      entries,
    },
    update: {
      postedAt: new Date(),
      entryCount: input.entries.length,
      entries,
    },
    select: { id: true },
  });
}

export async function getLatestWeeklyLeaderboardSnapshot(
  input: { serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<WeeklyLeaderboardSnapshot | undefined> {
  const row = await prismaClient.bucksWeeklyLeaderboardSnapshot.findFirst({
    where: { serverId: input.serverId },
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    select: { postedAt: true, entries: true },
  });
  if (row === null) {
    return undefined;
  }
  return {
    postedAt: row.postedAt,
    entries: BucksWeeklyLeaderboardEntriesSchema.parse(JSON.parse(row.entries)),
  };
}
