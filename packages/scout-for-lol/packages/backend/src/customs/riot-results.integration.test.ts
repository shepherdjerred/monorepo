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
const tournamentFixture = RawMatchSchema.parse({
  ...fixture,
  info: { ...fixture.info, tournamentCode: "TEST-CODE" },
});
const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNEL_ID = DiscordChannelIdSchema.parse("1337623164146155594");
const HOST_ID = DiscordAccountIdSchema.parse("160509172704739328");

async function seedPendingResult(
  options: {
    lobbyState?: "resolved" | "expired" | "in_game";
    linkMatch?: boolean;
    nightState?: "PLAYING" | "ENDED";
  } = {},
): Promise<{
  nightId: string;
  gameId: string;
  lobbyId: number;
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
  const blue = fixture.info.participants.filter(
    (participant) => participant.teamId === 100,
  );
  const red = fixture.info.participants.filter(
    (participant) => participant.teamId === 200,
  );
  const lobby = await testPrisma.tournamentLobby.create({
    data: {
      code: "TEST-CODE",
      apiMode: "live",
      providerId: 1,
      tournamentId: 2,
      region: "AMERICA_NORTH",
      platformId: "NA1",
      serverId: GUILD_ID,
      channelId: CHANNEL_ID,
      creatorDiscordId: HOST_ID,
      bluePuuids: JSON.stringify(blue.map((participant) => participant.puuid)),
      redPuuids: JSON.stringify(red.map((participant) => participant.puuid)),
      blueAliases: JSON.stringify(
        blue.map(
          (participant) => participant.riotIdGameName ?? participant.puuid,
        ),
      ),
      redAliases: JSON.stringify(
        red.map(
          (participant) => participant.riotIdGameName ?? participant.puuid,
        ),
      ),
      teamSize: 5,
      pickType: "TOURNAMENT_DRAFT",
      mapType: "SUMMONERS_RIFT",
      spectatorType: "ALL",
      state: options.lobbyState ?? "resolved",
      matchId: options.linkMatch === false ? null : fixture.metadata.matchId,
      expiresAt: new Date(fixture.info.gameCreation + 3 * 60 * 60 * 1000),
    },
  });
  const game = await testPrisma.customGame.create({
    data: {
      nightId: night.id,
      sequence: 1,
      state: "RESULT_PENDING",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      tournamentLobbyId: lobby.id,
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
  return { nightId: night.id, gameId: game.id, lobbyId: lobby.id };
}

beforeEach(async () => {
  await clearCustomsTestData(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function expectReportedAndVerified(seeded: {
  readonly lobbyId: number;
  readonly gameId: string;
}): Promise<void> {
  await expect(
    testPrisma.tournamentLobby.findUniqueOrThrow({
      where: { id: seeded.lobbyId },
    }),
  ).resolves.toMatchObject({ state: "reported" });
  await expect(
    testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
  ).resolves.toMatchObject({ state: "VERIFIED" });
}

async function detachHistoricalLobby(seeded: {
  readonly lobbyId: number;
  readonly gameId: string;
}): Promise<void> {
  await testPrisma.customGame.update({
    where: { id: seeded.gameId },
    data: { tournamentLobbyId: null },
  });
  await testPrisma.tournamentLobby.delete({ where: { id: seeded.lobbyId } });
}

describe("managed Customs results", () => {
  test("does not finalize an unobserved local lobby by roster alone", async () => {
    const seeded = await seedPendingResult({ linkMatch: false });
    await detachHistoricalLobby(seeded);

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
    const seeded = await seedPendingResult({ linkMatch: false });
    await detachHistoricalLobby(seeded);
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
    const seeded = await seedPendingResult({ linkMatch: false });
    await detachHistoricalLobby(seeded);
    await testPrisma.customGame.update({
      where: { id: seeded.gameId },
      data: {
        observedLobbyId: "observed-local-lobby",
        matchId: fixture.metadata.matchId,
      },
    });

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

    await finalizeManagedCustomResult(testPrisma, tournamentFixture);

    await expectReportedAndVerified(seeded);
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

    await finalizeManagedCustomResult(testPrisma, tournamentFixture);
    await expect(
      finalizeManagedCustomResult(testPrisma, tournamentFixture),
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

  test("a projection error rolls back before lobby and cursor completion", async () => {
    const seeded = await seedPendingResult();
    await testPrisma.customGameParticipant.deleteMany({
      where: { gameId: seeded.gameId, rosterOrder: 9 },
    });

    await expect(
      finalizeManagedCustomResult(testPrisma, tournamentFixture),
    ).rejects.toThrow("must have 10 participants");
    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({
        where: { id: seeded.lobbyId },
      }),
    ).resolves.toMatchObject({ state: "resolved" });
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

    await finalizeManagedCustomResult(testPrisma, tournamentFixture);

    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "ENDED", revision: 1 });
    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({ state: "VERIFIED" });
    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({
        where: { id: seeded.lobbyId },
      }),
    ).resolves.toMatchObject({ state: "reported" });
  });

  test("finalizes by tournament code before poller linkage", async () => {
    const seeded = await seedPendingResult({
      lobbyState: "in_game",
      linkMatch: false,
    });

    await finalizeManagedCustomResult(testPrisma, tournamentFixture);

    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({
        where: { id: seeded.lobbyId },
      }),
    ).resolves.toMatchObject({
      matchId: fixture.metadata.matchId,
      state: "reported",
    });
  });

  test("recovers an expired linked lobby when Match-V5 is delayed", async () => {
    const seeded = await seedPendingResult({ lobbyState: "expired" });

    await finalizeManagedCustomResult(testPrisma, tournamentFixture);

    await expectReportedAndVerified(seeded);
  });
});
