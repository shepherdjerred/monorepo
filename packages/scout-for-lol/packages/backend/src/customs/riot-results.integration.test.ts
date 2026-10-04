import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { finalizeManagedCustomResult } from "#src/customs/riot-results.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";

const { prisma: testPrisma } = createTestDatabase("customs-riot-results");
const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNEL_ID = DiscordChannelIdSchema.parse("1337623164146155594");
const HOST_ID = DiscordAccountIdSchema.parse("160509172704739328");

async function seedPendingResult(
  options: {
    /** Bind the game to the fixture's match, as an accepted observation does. */
    bindMatch?: boolean;
    nightState?: "PLAYING" | "ENDED";
  } = {},
): Promise<{
  nightId: string;
  gameId: string;
}> {
  const night = await testPrisma.customNight.create({
    data: {
      guildId: GUILD_ID,
      guildName: "Beta Guild",
      launchChannelId: CHANNEL_ID,
      voiceLobbyChannelId: CHANNEL_ID,
      hostDiscordId: HOST_ID,
      state: options.nightState ?? "PLAYING",
      lastActivityAt: new Date(fixture.info.gameCreation),
      expiresAt: new Date(fixture.info.gameCreation + 12 * 60 * 60 * 1000),
    },
  });
  await testPrisma.customActiveNight.create({
    data: { guildId: GUILD_ID, nightId: night.id },
  });
  const game = await testPrisma.customGame.create({
    data: {
      nightId: night.id,
      sequence: 1,
      state: "RESULT_PENDING",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      ...(options.bindMatch === false
        ? {}
        : {
            observedLobbyId: "observed-local-lobby",
            matchId: fixture.metadata.matchId,
          }),
    },
  });
  for (const [index, participant] of fixture.info.participants.entries()) {
    const blueSide = participant.teamId === 100;
    await testPrisma.customGameParticipant.create({
      data: {
        gameId: game.id,
        discordId: DiscordAccountIdSchema.parse(
          (160_509_172_704_739_400n + BigInt(index)).toString(),
        ),
        displayName: participant.riotIdGameName ?? participant.puuid,
        playerId: PlayerIdSchema.parse(index + 1),
        playerAlias: participant.riotIdGameName ?? participant.puuid,
        accountId: AccountIdSchema.parse(index + 1),
        puuid: LeaguePuuidSchema.parse(participant.puuid),
        riotGameName: participant.riotIdGameName ?? null,
        riotTagLine: participant.riotIdTagline,
        rosterOrder: index,
        team: blueSide ? "A" : "B",
        side: blueSide ? "BLUE" : "RED",
        captain: index === 0 || index === 5,
      },
    });
  }
  return { nightId: night.id, gameId: game.id };
}

beforeEach(async () => {
  await clearCustomsTestData(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function expectVerified(seeded: {
  readonly gameId: string;
}): Promise<void> {
  await expect(
    testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
  ).resolves.toMatchObject({
    state: "VERIFIED",
    matchId: fixture.metadata.matchId,
  });
}

describe("managed Customs results", () => {
  test("does not finalize an unobserved local lobby by roster alone", async () => {
    const seeded = await seedPendingResult({ bindMatch: false });

    await expect(
      finalizeManagedCustomResult(testPrisma, fixture),
    ).resolves.toBeUndefined();

    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({
      state: "RESULT_PENDING",
      matchId: null,
      observedLobbyId: null,
    });
    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "PLAYING", revision: 0 });
  });

  test("does not finalize an observed lobby from its roster alone", async () => {
    const seeded = await seedPendingResult({ bindMatch: false });
    await testPrisma.customGame.update({
      where: { id: seeded.gameId },
      data: { observedLobbyId: "observed-local-lobby" },
    });

    await expect(
      finalizeManagedCustomResult(testPrisma, fixture),
    ).resolves.toBeUndefined();

    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({
      state: "RESULT_PENDING",
      matchId: null,
      observedLobbyId: "observed-local-lobby",
    });
  });

  test("finalizes an observed lobby by its attached match identity", async () => {
    const seeded = await seedPendingResult();

    await expect(
      finalizeManagedCustomResult(testPrisma, fixture, "SCOUT_CLIENT"),
    ).resolves.toBe(seeded.nightId);

    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({
      state: "VERIFIED",
      matchId: fixture.metadata.matchId,
      observedLobbyId: "observed-local-lobby",
    });
    await expect(
      testPrisma.customAuditEvent.findFirstOrThrow({
        where: { gameId: seeded.gameId },
      }),
    ).resolves.toMatchObject({
      actorId: "scout-client:canonical-match",
      action: "SCOUT_CLIENT_RESULT_VERIFIED",
      source: "SCOUT_CLIENT",
    });
  });

  test("projects Match-V5 and opens intermission in one transaction", async () => {
    const seeded = await seedPendingResult();

    await finalizeManagedCustomResult(testPrisma, fixture);

    await expectVerified(seeded);
    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "INTERMISSION", revision: 1 });
    await expect(
      testPrisma.customGameParticipant.count({
        where: { gameId: seeded.gameId, championId: { not: null } },
      }),
    ).resolves.toBe(10);
    await expect(
      testPrisma.customAuditEvent.findFirstOrThrow({
        where: { nightId: seeded.nightId },
      }),
    ).resolves.toMatchObject({
      source: "RIOT",
      action: "RIOT_RESULT_VERIFIED",
      revision: 1,
    });
  });

  test("treats a retry after verified result commit as success", async () => {
    const seeded = await seedPendingResult();

    await finalizeManagedCustomResult(testPrisma, fixture);
    await expect(
      finalizeManagedCustomResult(testPrisma, fixture),
    ).resolves.toBe(seeded.nightId);

    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "INTERMISSION", revision: 1 });
    await expect(
      testPrisma.customAuditEvent.count({ where: { gameId: seeded.gameId } }),
    ).resolves.toBe(1);
  });

  test("a projection error rolls back before cursor completion", async () => {
    const seeded = await seedPendingResult();
    await testPrisma.customGameParticipant.deleteMany({
      where: { gameId: seeded.gameId, rosterOrder: 9 },
    });

    await expect(
      finalizeManagedCustomResult(testPrisma, fixture),
    ).rejects.toThrow("must have 10 participants");
    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({ state: "RESULT_PENDING" });
    await expect(
      testPrisma.customAuditEvent.count({ where: { nightId: seeded.nightId } }),
    ).resolves.toBe(0);
  });

  test("preserves an ended night while recording its authoritative result", async () => {
    const seeded = await seedPendingResult({ nightState: "ENDED" });
    await testPrisma.customActiveNight.delete({ where: { guildId: GUILD_ID } });

    await finalizeManagedCustomResult(testPrisma, fixture);

    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "ENDED", revision: 1 });
    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({ state: "VERIFIED" });
  });
});
