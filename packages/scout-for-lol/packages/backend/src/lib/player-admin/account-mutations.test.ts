import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  DiscordAccountId,
  LeaguePuuid,
  PlayerId,
  Region,
  RiotId,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("account-admin-mutations");
const puuidsByRiotName = new Map<string, LeaguePuuid>();

void mock.module("#src/database/index.ts", () => ({ prisma }));
void mock.module("#src/trpc/guild-guard.ts", () => ({
  assertGuildAdmin: () => Promise.resolve(),
}));
void mock.module("#src/league/api/backfill-match-history.ts", () => ({
  backfillLastMatchTime: () => Promise.resolve(),
}));
void mock.module("#src/discord/commands/admin/utils/riot-api.ts", () => ({
  resolvePuuidFromRiotId: (riotId: RiotId, _region: Region) =>
    Promise.resolve({
      success: true,
      puuid: puuidsByRiotName.get(riotId.game_name) ?? testPuuid("default"),
      lookupTime: 0,
    }),
}));

const { deleteAccount, transferAccount } =
  await import("#src/lib/player-admin/account-mutations.ts");

const guildId = testGuildId("9931");
const actorDiscordId = testAccountId("9932");
const ctx = {
  user: createUser(actorDiscordId),
  webSession: { ipAddress: "127.0.0.1", userAgent: "bun-test" },
};

beforeEach(async () => {
  puuidsByRiotName.clear();
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

describe("account admin mutations", () => {
  test("deleteAccount rejects deleting the last account without audit", async () => {
    const player = await createPlayer("Solo");
    const puuid = testPuuid("solo-account");
    await createAccount(player.id, puuid);
    puuidsByRiotName.set("SoloMain", puuid);

    await expect(
      deleteAccount(ctx, {
        guildId,
        riotId: { game_name: "SoloMain", tag_line: "NA1" },
        region: "AMERICA_NORTH",
      }),
    ).rejects.toThrow("Cannot remove the last account from a player");

    expect(await prisma.account.count({ where: { playerId: player.id } })).toBe(
      1,
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test("transferAccount rejects transferring the last account without audit", async () => {
    const source = await createPlayer("Source");
    await createPlayer("Target");
    const puuid = testPuuid("source-account");
    await createAccount(source.id, puuid);
    puuidsByRiotName.set("SourceMain", puuid);

    await expect(
      transferAccount(ctx, {
        guildId,
        riotId: { game_name: "SourceMain", tag_line: "NA1" },
        region: "AMERICA_NORTH",
        toPlayerAlias: "Target",
      }),
    ).rejects.toThrow("Cannot transfer the last account from a player");

    const account = await prisma.account.findUnique({
      where: { serverId_puuid: { serverId: guildId, puuid } },
    });
    expect(account).toMatchObject({ playerId: source.id });
    expect(await prisma.auditLog.count()).toBe(0);
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
