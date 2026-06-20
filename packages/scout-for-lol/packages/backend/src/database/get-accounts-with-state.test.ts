import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { getAccountsWithState } from "#src/database/index.ts";
import {
  testGuildId,
  testAccountId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const { prisma } = createTestDatabase("accounts-with-state-test");

const guildA = testGuildId("440000000000000001");
const guildB = testGuildId("550000000000000002");

async function seedPlayerWithAccount(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  alias: string,
): Promise<void> {
  const now = new Date();
  const player = await db.player.create({
    data: {
      alias,
      discordId: testAccountId("700"),
      serverId,
      creatorDiscordId: testAccountId("701"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.account.create({
    data: {
      puuid: testPuuid(`${alias}-${serverId}`),
      region: "AMERICA_NORTH",
      alias,
      playerId: player.id,
      serverId,
      creatorDiscordId: testAccountId("701"),
      createdTime: now,
      updatedTime: now,
    },
  });
}

beforeEach(async () => {
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getAccountsWithState - guild membership filter", () => {
  test("returns all accounts when no filter is provided", async () => {
    await seedPlayerWithAccount(prisma, guildA, "alpha");
    await seedPlayerWithAccount(prisma, guildB, "bravo");

    const accounts = await getAccountsWithState(prisma);
    expect(accounts).toHaveLength(2);
  });

  test("only returns accounts for guilds in the active set", async () => {
    await seedPlayerWithAccount(prisma, guildA, "alpha");
    await seedPlayerWithAccount(prisma, guildB, "bravo");

    const accounts = await getAccountsWithState(prisma, new Set([guildA]));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.config.alias).toBe("alpha");
  });

  test("returns nothing when the active set excludes all guilds", async () => {
    await seedPlayerWithAccount(prisma, guildA, "alpha");

    const accounts = await getAccountsWithState(prisma, new Set([guildB]));
    expect(accounts).toHaveLength(0);
  });
});
