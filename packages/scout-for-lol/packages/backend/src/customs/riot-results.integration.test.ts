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
import {
  createLobby,
  updateLobby,
} from "#src/league/tournament/lobby-store.ts";
import { finalizeTournamentResult } from "#src/customs/riot-results.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { projectTournamentLobbyToCustoms } from "#src/customs/lobby-projection.ts";

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
  const lobby = await createLobby(testPrisma, {
    code: "TEST-CODE",
    apiMode: "live",
    providerId: 1,
    tournamentId: 2,
    region: "AMERICA_NORTH",
    platformId: "NA1",
    serverId: GUILD_ID,
    channelId: CHANNEL_ID,
    creatorDiscordId: HOST_ID,
    bluePuuids: blue.map((participant) => participant.puuid),
    redPuuids: red.map((participant) => participant.puuid),
    blueAliases: blue.map(
      (participant) => participant.riotIdGameName ?? participant.puuid,
    ),
    redAliases: red.map(
      (participant) => participant.riotIdGameName ?? participant.puuid,
    ),
    teamSize: 5,
    pickType: "TOURNAMENT_DRAFT",
    mapType: "SUMMONERS_RIFT",
    spectatorType: "ALL",
    lobbyName: undefined,
    password: undefined,
    expiresAt: new Date(fixture.info.gameCreation + 3 * 60 * 60 * 1000),
  });
  await updateLobby(testPrisma, lobby.id, {
    state: options.lobbyState ?? "resolved",
    ...(options.linkMatch === false
      ? {}
      : { matchId: fixture.metadata.matchId }),
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

describe("Riot-only Customs results", () => {
  test("projects Tournament-V5 progress before Match-V5 verification", async () => {
    const seeded = await seedPendingResult();
    await testPrisma.customGame.update({
      where: { id: seeded.gameId },
      data: { state: "LOBBY_READY" },
    });
    await testPrisma.customNight.update({
      where: { id: seeded.nightId },
      data: { state: "LOBBY_READY" },
    });

    await projectTournamentLobbyToCustoms(
      testPrisma,
      seeded.lobbyId,
      "resolved",
      new Date(fixture.info.gameEndTimestamp),
    );

    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: seeded.gameId } }),
    ).resolves.toMatchObject({ state: "RESULT_PENDING" });
    await expect(
      testPrisma.customNight.findUniqueOrThrow({
        where: { id: seeded.nightId },
      }),
    ).resolves.toMatchObject({ state: "PLAYING", revision: 1 });
  });

  test("projects Match-V5 and opens intermission in one transaction", async () => {
    const seeded = await seedPendingResult();

    await finalizeTournamentResult(testPrisma, tournamentFixture);

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

  test("a projection error rolls back before lobby and cursor completion", async () => {
    const seeded = await seedPendingResult();
    await testPrisma.customGameParticipant.deleteMany({
      where: { gameId: seeded.gameId, rosterOrder: 9 },
    });

    await expect(
      finalizeTournamentResult(testPrisma, tournamentFixture),
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

    await finalizeTournamentResult(testPrisma, tournamentFixture);

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

    await finalizeTournamentResult(testPrisma, tournamentFixture);

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

    await finalizeTournamentResult(testPrisma, tournamentFixture);

    await expectReportedAndVerified(seeded);
  });
});
