import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  getLatestWeeklyLeaderboardSnapshot,
  saveWeeklyLeaderboardSnapshot,
} from "#src/betting/weekly-leaderboard-snapshot.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-weekly-leaderboard-snapshot");

const SERVER_ID = DiscordGuildIdSchema.parse("100000000000000081");
const OTHER_SERVER_ID = DiscordGuildIdSchema.parse("100000000000000082");

beforeEach(async () => {
  await db.bucksWeeklyLeaderboardSnapshot.deleteMany();
});

afterAll(async () => {
  await db.bucksWeeklyLeaderboardSnapshot.deleteMany();
  await db.$disconnect();
});

describe("weekly leaderboard snapshots", () => {
  test("answers nothing before the first Friday run", async () => {
    expect(
      await getLatestWeeklyLeaderboardSnapshot({ serverId: SERVER_ID }, db),
    ).toBeUndefined();
  });

  test("a cron retry upserts its own week instead of duplicating it", async () => {
    await saveWeeklyLeaderboardSnapshot(
      {
        serverId: SERVER_ID,
        runWeek: 2955,
        entries: [{ rank: 1, discordId: bucksTestDiscordId(1), balance: 10 }],
      },
      db,
    );
    await saveWeeklyLeaderboardSnapshot(
      {
        serverId: SERVER_ID,
        runWeek: 2955,
        entries: [
          { rank: 1, discordId: bucksTestDiscordId(1), balance: 12 },
          { rank: 2, discordId: bucksTestDiscordId(2), balance: 3 },
        ],
      },
      db,
    );
    expect(await db.bucksWeeklyLeaderboardSnapshot.count()).toBe(1);
    const latest = await getLatestWeeklyLeaderboardSnapshot(
      { serverId: SERVER_ID },
      db,
    );
    expect(latest?.entries).toHaveLength(2);
    const stored = await db.bucksWeeklyLeaderboardSnapshot.findFirstOrThrow();
    expect(stored.entryCount).toBe(2);
  });

  test("the latest snapshot wins and guilds stay isolated", async () => {
    await saveWeeklyLeaderboardSnapshot(
      {
        serverId: SERVER_ID,
        runWeek: 2955,
        entries: [{ rank: 1, discordId: bucksTestDiscordId(1), balance: 10 }],
      },
      db,
    );
    await saveWeeklyLeaderboardSnapshot(
      {
        serverId: SERVER_ID,
        runWeek: 2956,
        entries: [{ rank: 1, discordId: bucksTestDiscordId(2), balance: 99 }],
      },
      db,
    );
    const latest = await getLatestWeeklyLeaderboardSnapshot(
      { serverId: SERVER_ID },
      db,
    );
    expect(latest?.entries[0]?.balance).toBe(99);
    expect(
      await getLatestWeeklyLeaderboardSnapshot(
        { serverId: OTHER_SERVER_ID },
        db,
      ),
    ).toBeUndefined();
  });
});
