import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  DiscordAccountId,
  DiscordChannelId,
  LeaguePuuid,
  PlayerId,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("player-admin-mutations");

void mock.module("#src/database/index.ts", () => ({ prisma }));
void mock.module("#src/trpc/guild-guard.ts", () => ({
  assertGuildAdmin: () => Promise.resolve(),
  // Must mirror the module's full export surface. bun's `mock.module` is
  // process-global, so any router linked after this file runs would otherwise
  // fail to resolve this static import ("Export named 'assertChannelInGuild'
  // not found in module guild-guard.ts"), depending on test-file order.
  assertChannelInGuild: () => {
    /* no-op: real bot-cache membership check is out of scope offline */
  },
}));

const { deletePlayer, linkDiscord, mergePlayers, renamePlayer, unlinkDiscord } =
  await import("#src/lib/player-admin/player-mutations.ts");

const guildId = testGuildId("9901");
const actorDiscordId = testAccountId("9902");
const ctx = {
  user: createUser(actorDiscordId),
  webSession: { ipAddress: "127.0.0.1", userAgent: "bun-test" },
};

beforeEach(async () => {
  await deleteIfExists(() => prisma.auditLog.deleteMany());
  await deleteIfExists(() => prisma.subscription.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("player admin mutations", () => {
  test("renames a player and writes an audit row", async () => {
    const player = await createPlayer("Before");

    await expect(
      renamePlayer(ctx, {
        guildId,
        currentAlias: player.alias,
        newAlias: "After",
      }),
    ).resolves.toEqual({ alias: "After" });

    const renamed = await prisma.player.findUnique({
      where: { serverId_alias: { serverId: guildId, alias: "After" } },
    });
    expect(renamed).toMatchObject({ id: player.id });
    const auditRows = await prisma.auditLog.findMany();
    expect(auditRows).toMatchObject([
      { action: "PLAYER_RENAME", targetPlayerId: player.id },
    ]);
  });

  test("rename reports not found when the current alias does not exist", async () => {
    await expect(
      renamePlayer(ctx, {
        guildId,
        currentAlias: "Missing",
        newAlias: "After",
      }),
    ).rejects.toThrow('Player "Missing" was not found');
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test("links and unlinks Discord with audit rows", async () => {
    const player = await createPlayer("Discordless");
    const discordUserId = testAccountId("9903");

    await expect(
      linkDiscord(ctx, { guildId, playerAlias: player.alias, discordUserId }),
    ).resolves.toEqual({ alias: player.alias, discordId: discordUserId });
    await expect(
      unlinkDiscord(ctx, { guildId, playerAlias: player.alias }),
    ).resolves.toEqual({ alias: player.alias });

    const unlinked = await prisma.player.findUnique({
      where: { id: player.id },
    });
    expect(unlinked).toMatchObject({ discordId: null });
    const auditRows = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(auditRows).toMatchObject([
      { action: "PLAYER_LINK_DISCORD", targetPlayerId: player.id },
      { action: "PLAYER_UNLINK_DISCORD", targetPlayerId: player.id },
    ]);
  });

  test("deletes a player transactionally with related account and subscription", async () => {
    const player = await createPlayer("DeleteMe");
    await createAccount(player.id, testPuuid("delete"));
    await createSubscription(player.id, testChannelId("9910"));

    await expect(
      deletePlayer(ctx, { guildId, alias: player.alias }),
    ).resolves.toEqual({ deletedAlias: player.alias });

    expect(await prisma.player.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    const auditRows = await prisma.auditLog.findMany();
    expect(auditRows).toMatchObject([
      { action: "PLAYER_DELETE", targetPlayerId: player.id },
    ]);
  });

  test("merges accounts and non-duplicate subscriptions into the target player", async () => {
    const source = await createPlayer("Source");
    const target = await createPlayer("Target");
    const duplicateChannelId = testChannelId("9920");
    const movedChannelId = testChannelId("9921");
    await createAccount(source.id, testPuuid("source"));
    await createSubscription(source.id, duplicateChannelId);
    await createSubscription(source.id, movedChannelId);
    await createSubscription(target.id, duplicateChannelId);

    await expect(
      mergePlayers(ctx, {
        guildId,
        sourceAlias: source.alias,
        targetAlias: target.alias,
      }),
    ).resolves.toEqual({
      sourceAlias: source.alias,
      targetAlias: target.alias,
    });

    expect(
      await prisma.player.findUnique({ where: { id: source.id } }),
    ).toBeNull();
    const accounts = await prisma.account.findMany({
      where: { playerId: target.id },
      select: { puuid: true },
    });
    expect(accounts).toEqual([{ puuid: testPuuid("source") }]);
    const subscriptions = await prisma.subscription.findMany({
      where: { playerId: target.id },
      orderBy: { channelId: "asc" },
      select: { channelId: true },
    });
    expect(subscriptions).toEqual([
      { channelId: duplicateChannelId },
      { channelId: movedChannelId },
    ]);
    const auditRows = await prisma.auditLog.findMany();
    expect(auditRows).toMatchObject([
      { action: "PLAYER_MERGE", targetPlayerId: target.id },
    ]);
  });
});

function createUser(discordId: DiscordAccountId): User {
  return {
    discordId,
    discordUsername: "Test Admin",
    discordAvatar: null,
    discordAccessToken: "access",
    discordRefreshToken: "refresh",
    tokenExpiresAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function createPlayer(alias: string) {
  const now = new Date();
  return prisma.player.create({
    data: {
      alias,
      discordId: null,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function createAccount(playerId: PlayerId, puuid: LeaguePuuid) {
  const now = new Date();
  return prisma.account.create({
    data: {
      alias: "account",
      puuid,
      region: "AMERICA_NORTH",
      playerId,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function createSubscription(
  playerId: PlayerId,
  channelId: DiscordChannelId,
) {
  const now = new Date();
  return prisma.subscription.create({
    data: {
      playerId,
      channelId,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}
