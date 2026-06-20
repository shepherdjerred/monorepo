import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { recordPermissionError } from "#src/database/guild-permission-errors.ts";
import {
  testGuildId,
  testAccountId,
  testChannelId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const { prisma } = createTestDatabase("remove-guild-test");

/**
 * Seed a full slice of a guild's data: player + account + subscription +
 * competition (with a participant) + report + server permission + a permission
 * error. Returns the created player id.
 */
async function seedGuild(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<number> {
  const now = new Date();
  const creator = testAccountId("900");
  const owner = testAccountId("901");
  const channelId = testChannelId("100");

  const player = await db.player.create({
    data: {
      alias: `player-${serverId}`,
      discordId: owner,
      serverId,
      creatorDiscordId: creator,
      createdTime: now,
      updatedTime: now,
    },
  });

  await db.account.create({
    data: {
      puuid: testPuuid(`acct-${serverId}`),
      region: "AMERICA_NORTH",
      alias: `player-${serverId}`,
      playerId: player.id,
      serverId,
      creatorDiscordId: creator,
      createdTime: now,
      updatedTime: now,
    },
  });

  await db.subscription.create({
    data: {
      playerId: player.id,
      channelId,
      serverId,
      creatorDiscordId: creator,
      createdTime: now,
      updatedTime: now,
    },
  });

  const competition = await db.competition.create({
    data: {
      serverId,
      ownerId: owner,
      title: "Ranked",
      description: "Highest rank",
      channelId,
      visibility: "OPEN",
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: "{}",
      creatorDiscordId: creator,
      createdTime: now,
      updatedTime: now,
    },
  });

  await db.competitionParticipant.create({
    data: {
      competitionId: competition.id,
      playerId: player.id,
      status: "JOINED",
    },
  });

  await db.report.create({
    data: {
      serverId,
      ownerId: owner,
      channelId,
      title: "Ranked",
      queryText: "SELECT 1",
      cronExpression: "0 0 * * *",
      isSystemManaged: true,
      systemSource: "COMPETITION",
      sourceCompetitionId: competition.id,
      createdTime: now,
      updatedTime: now,
    },
  });

  await db.serverPermission.create({
    data: {
      serverId,
      discordUserId: owner,
      permission: "CREATE_COMPETITION",
      grantedBy: creator,
      grantedAt: now,
    },
  });

  await recordPermissionError(db, {
    serverId,
    channelId,
    errorType: "api_error",
  });

  return player.id;
}

async function countGuild(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<Record<string, number>> {
  return {
    players: await db.player.count({ where: { serverId } }),
    accounts: await db.account.count({ where: { serverId } }),
    subscriptions: await db.subscription.count({ where: { serverId } }),
    competitions: await db.competition.count({ where: { serverId } }),
    reports: await db.report.count({ where: { serverId } }),
    serverPermissions: await db.serverPermission.count({ where: { serverId } }),
    permissionErrors: await db.guildPermissionError.count({
      where: { serverId },
    }),
  };
}

const guildA = testGuildId("111000000000000001");
const guildB = testGuildId("222000000000000002");

beforeEach(async () => {
  // Order matters for FKs: delete children before parents.
  await prisma.competitionParticipant.deleteMany();
  await prisma.competitionSnapshot.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.report.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.serverPermission.deleteMany();
  await prisma.guildPermissionError.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cleanupRemovedGuild", () => {
  test("deletes all of the removed guild's data and leaves other guilds intact", async () => {
    await seedGuild(prisma, guildA);
    await seedGuild(prisma, guildB);

    const summary = await cleanupRemovedGuild(prisma, guildA);

    // Everything for guild A is reported deleted...
    expect(summary).toEqual({
      competitions: 1,
      reports: 1,
      subscriptions: 1,
      serverPermissions: 1,
      accounts: 1,
      players: 1,
      permissionErrors: 1,
    });

    // ...and actually gone from the database.
    const afterA = await countGuild(prisma, guildA);
    expect(afterA).toEqual({
      players: 0,
      accounts: 0,
      subscriptions: 0,
      competitions: 0,
      reports: 0,
      serverPermissions: 0,
      permissionErrors: 0,
    });

    // The cascade removed the competition participant too.
    expect(await prisma.competitionParticipant.count()).toBe(1); // only guild B's

    // Guild B is untouched.
    const afterB = await countGuild(prisma, guildB);
    expect(afterB).toEqual({
      players: 1,
      accounts: 1,
      subscriptions: 1,
      competitions: 1,
      reports: 1,
      serverPermissions: 1,
      permissionErrors: 1,
    });
  });

  test("is idempotent: cleaning an already-clean guild deletes nothing", async () => {
    const summary = await cleanupRemovedGuild(prisma, guildA);
    expect(summary).toEqual({
      competitions: 0,
      reports: 0,
      subscriptions: 0,
      serverPermissions: 0,
      accounts: 0,
      players: 0,
      permissionErrors: 0,
    });
  });
});
