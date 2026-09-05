import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  LeaguePuuid,
  PlayerId,
  Region,
  RiotId,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { createTestUser } from "#src/testing/test-user.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const { prisma } = createTestDatabase("account-admin-mutations");
const puuidsByRiotName = new Map<string, LeaguePuuid>();

vi.doMock("#src/database/index.ts", () => ({ prisma }));
vi.doMock("#src/trpc/guild-guard.ts", () => ({
  assertGuildAdmin: () => Promise.resolve(),
  // Mirror the module's full export surface because routers linked by the
  // module under test resolve both static exports.
  assertChannelInGuild: () => {
    /* no-op: real bot-cache membership check is out of scope offline */
  },
}));
vi.doMock("#src/league/api/backfill-match-history.ts", () => ({
  backfillLastMatchTime: () => Promise.resolve(),
}));
vi.doMock("#src/lib/riot/resolve-puuid.ts", () => ({
  resolvePuuidFromRiotId: (riotId: RiotId, _region: Region) =>
    Promise.resolve({
      success: true,
      puuid: puuidsByRiotName.get(riotId.game_name) ?? testPuuid("default"),
      lookupTime: 0,
    }),
}));

const { addAccount, deleteAccount, transferAccount } =
  await import("#src/lib/player-admin/account-mutations.ts");

const guildId = testGuildId("9931");
const actorDiscordId = testAccountId("9932");
const ctx = {
  user: createTestUser(actorDiscordId),
  webSession: { ipAddress: "127.0.0.1", userAgent: "bun-test" },
};

beforeEach(async () => {
  resetFlagOverrides("initial_match_history_import_enabled");
  puuidsByRiotName.clear();
  await deleteIfExists(() => prisma.initialMatchHistoryImport.deleteMany());
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
  test("atomically enqueues first-run history when the guild flag is enabled", async () => {
    await createPlayer("History Player");
    const puuid = testPuuid("history-account");
    puuidsByRiotName.set("HistoryMain", puuid);
    addFlagOverride("initial_match_history_import_enabled", true, {
      server: guildId,
    });

    await addAccount(ctx, {
      guildId,
      playerAlias: "History Player",
      riotId: { game_name: "HistoryMain", tag_line: "NA1" },
      region: "AMERICA_NORTH",
    });

    expect(
      await prisma.initialMatchHistoryImport.findUnique({ where: { puuid } }),
    ).toMatchObject({ phase: "queued", region: "AMERICA_NORTH" });
  });

  test("preserves timestamp-only onboarding when the guild flag is disabled", async () => {
    await createPlayer("Legacy Player");
    const puuid = testPuuid("legacy-account");
    puuidsByRiotName.set("LegacyMain", puuid);

    await addAccount(ctx, {
      guildId,
      playerAlias: "Legacy Player",
      riotId: { game_name: "LegacyMain", tag_line: "NA1" },
      region: "AMERICA_NORTH",
    });

    expect(
      await prisma.initialMatchHistoryImport.findUnique({ where: { puuid } }),
    ).toBeNull();
  });

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
