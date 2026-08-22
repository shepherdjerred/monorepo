import { afterAll, describe, expect, test } from "vitest";
import {
  CustomNightSnapshotSchema,
  RawMatchSchema,
  type RawMatch,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { importCustomMatchDetails } from "#src/customs/match-import.ts";
import { createCustomNight, endCustomNight } from "#src/customs/service.ts";
import { overrideCustomVoice } from "#src/customs/lifecycle-service.ts";
import {
  provisionCustomTournamentCode,
  recordRiotTournamentResult,
} from "#src/customs/riot-results.ts";
import { retryPendingCustomImports } from "#src/customs/reconciler.ts";
import { shouldPublishCustomSnapshot } from "#src/customs/socket.ts";
import {
  commitCustomMutation,
  getCustomNight,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("customs-tournament-provisioning");
const HOST_ID = "12345678901234567";
const ENDED_GUILD_ID = "22345678901234567";
const RACE_GUILD_ID = "32345678901234567";
const VOICE_GUILD_ID = "42345678901234567";
const PRIVATE_MATCH_GUILD_ID = "52345678901234567";
const RESULT_RACE_GUILD_ID = "62345678901234567";
const LATE_RESULT_GUILD_ID = "72345678901234567";
const NOW = new Date("2026-08-16T09:00:00.000Z");
const PICK_ORDERS = [null, 1, 4, 5, 8, null, 2, 3, 6, 7] as const;
const MATCH_FIXTURE_URL = new URL(
  "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
  import.meta.url,
);

async function matchFixture(): Promise<RawMatch> {
  const input: unknown = await Bun.file(MATCH_FIXTURE_URL).json();
  return RawMatchSchema.parse(input);
}

function participant(index: number) {
  const team = index < 5 ? "A" : "B";
  return {
    discordId: (10_000_000_000_000_000n + BigInt(index)).toString(),
    displayName: `Player ${index.toString()}`,
    playerId: index + 1,
    playerAlias: `player-${index.toString()}`,
    accountId: index + 1,
    puuid: index.toString().padEnd(78, "p"),
    riotGameName: `Player${index.toString()}`,
    riotTagLine: "NA1",
    rosterOrder: index,
    benchOrder: null,
    team,
    side: team === "A" ? "BLUE" : "RED",
    captain: index === 0 || index === 5,
    pickOrder: PICK_ORDERS[index] ?? null,
    championId: null,
    won: null,
  };
}

async function replaceParticipantAndAssertRows(
  snapshot: CustomNightSnapshot,
): Promise<void> {
  const finalizedGame = snapshot.currentGame;
  if (finalizedGame === null) throw new Error("Expected a finalized game");
  const outgoingDiscordId = finalizedGame.participants[1]?.discordId;
  if (outgoingDiscordId === undefined)
    throw new Error("Expected an outgoing game participant");
  const replacement = {
    ...participant(10),
    rosterOrder: 1,
    team: "A" as const,
    side: "BLUE" as const,
    captain: false,
    pickOrder: 1,
  };
  await commitCustomMutation({
    prisma,
    nightId: snapshot.id,
    expectedRevision: snapshot.revision,
    actorDiscordId: HOST_ID,
    action: "TEST_PARTICIPANT_REPLACED",
    payload: {},
    update: (current) => {
      if (current.currentGame === null)
        throw new Error("Expected a current game");
      return CustomNightSnapshotSchema.parse({
        ...current,
        currentGame: {
          ...current.currentGame,
          participants: current.currentGame.participants.map(
            (gameParticipant) =>
              gameParticipant.discordId === outgoingDiscordId
                ? replacement
                : gameParticipant,
          ),
        },
      });
    },
  });
  expect(
    await prisma.customGameParticipant.count({
      where: { gameId: finalizedGame.id },
    }),
  ).toBe(10);
  expect(
    await prisma.customGameParticipant.findUnique({
      where: {
        gameId_discordId: {
          gameId: finalizedGame.id,
          discordId: outgoingDiscordId,
        },
      },
    }),
  ).toBeNull();
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Customs persistence recovery", () => {
  test("does not publish an ended night over its replacement", async () => {
    const ended = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: LATE_RESULT_GUILD_ID,
      guildName: "Late result guild",
      launchChannelId: LATE_RESULT_GUILD_ID,
      voiceLobbyChannelId: LATE_RESULT_GUILD_ID,
      now: NOW,
    });
    const endedResult = await endCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      nightId: ended.snapshot.id,
      expectedRevision: ended.snapshot.revision,
      now: new Date(NOW.getTime() + 1000),
    });
    expect(endedResult.applied).toBe(true);

    const replacement = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: LATE_RESULT_GUILD_ID,
      guildName: "Late result guild",
      launchChannelId: LATE_RESULT_GUILD_ID,
      voiceLobbyChannelId: LATE_RESULT_GUILD_ID,
      now: new Date(NOW.getTime() + 2000),
    });

    expect(await shouldPublishCustomSnapshot(prisma, ended.snapshot.id)).toBe(
      false,
    );
    expect(
      await shouldPublishCustomSnapshot(prisma, replacement.snapshot.id),
    ).toBe(true);
  });

  test("returns one active night across concurrent create requests", async () => {
    const create = async () =>
      await createCustomNight({
        prisma,
        actor: { discordId: HOST_ID, discordAdministrator: false },
        guildId: RACE_GUILD_ID,
        guildName: "Race guild",
        launchChannelId: RACE_GUILD_ID,
        voiceLobbyChannelId: RACE_GUILD_ID,
        now: NOW,
      });
    const results = await Promise.all([create(), create()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.snapshot.id)).size).toBe(1);
    expect(
      await prisma.customNight.count({ where: { guildId: RACE_GUILD_ID } }),
    ).toBe(1);
  });

  test("claims once and finalizes across an unrelated revision change", async () => {
    const created = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: HOST_ID,
      guildName: "Guild",
      launchChannelId: HOST_ID,
      voiceLobbyChannelId: HOST_ID,
      now: NOW,
    });
    const seeded = await commitCustomMutation({
      prisma,
      nightId: created.snapshot.id,
      expectedRevision: created.snapshot.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_GAME_LOCKED",
      payload: {},
      update: (snapshot) =>
        CustomNightSnapshotSchema.parse({
          ...snapshot,
          state: "LOBBY_READY",
          riotTournamentId: "42",
          currentGame: {
            id: "105fbf72-e1cf-4ec7-801c-ad58b6987b72",
            sequence: 1,
            state: "CODE_PENDING",
            rosterMode: "FIRST_TEN",
            map: "SUMMONERS_RIFT",
            pickMode: "TOURNAMENT_DRAFT",
            participants: Array.from({ length: 10 }, (_, index) =>
              participant(index),
            ),
            activeCaptain: null,
            tournamentCode: null,
            tournamentCodeProvisioning: null,
            riotMatchId: null,
            winner: null,
            resultSource: null,
            resultDisagreement: false,
            repeatChampionWarnings: [],
            voiceReady: true,
            voiceOverride: false,
            voiceError: null,
            createdAt: NOW.toISOString(),
            startedAt: null,
            completedAt: null,
          },
        }),
    });
    expect(seeded.applied).toBe(true);

    const codeRequested = Promise.withResolvers<true>();
    const releaseCode = Promise.withResolvers<true>();
    let tournamentRequests = 0;
    let codeRequests = 0;
    const fetcher = async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/tournaments")) tournamentRequests += 1;
      if (url.includes("/codes?")) {
        codeRequests += 1;
        codeRequested.resolve(true);
        await releaseCode.promise;
        return Response.json(["TOURNAMENT-CODE"]);
      }
      throw new Error(`Unexpected Riot request: ${url}`);
    };

    const first = provisionCustomTournamentCode({
      prisma,
      nightId: created.snapshot.id,
      actorDiscordId: HOST_ID,
      fetcher,
    });
    await codeRequested.promise;

    const second = await provisionCustomTournamentCode({
      prisma,
      nightId: created.snapshot.id,
      actorDiscordId: HOST_ID,
      fetcher,
    });
    expect(second.applied).toBe(false);
    expect(second.snapshot.expiresAt).toBe(seeded.snapshot.expiresAt);
    await expect(
      endCustomNight({
        prisma,
        actor: { discordId: HOST_ID, discordAdministrator: false },
        nightId: created.snapshot.id,
        expectedRevision: second.snapshot.revision,
        now: new Date(NOW.getTime() + 1000),
      }),
    ).rejects.toThrow(
      "Wait for Tournament code provisioning to finish before ending the night",
    );

    const concurrent = await getCustomNight(prisma, created.snapshot.id);
    if (concurrent === null) throw new Error("Custom night not found");
    const concurrentMutation = await commitCustomMutation({
      prisma,
      nightId: concurrent.id,
      expectedRevision: concurrent.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_CONCURRENT_MUTATION",
      payload: {},
      update: (snapshot) => refreshSnapshot(snapshot, new Date()),
    });

    releaseCode.resolve(true);
    const result = await first;
    expect(result.applied).toBe(true);
    expect(result.snapshot.currentGame?.state).toBe("LOBBY_READY");
    expect(result.snapshot.currentGame?.tournamentCode).toBe("TOURNAMENT-CODE");
    expect(result.snapshot.currentGame?.tournamentCodeProvisioning).toBeNull();
    expect(result.snapshot.expiresAt).toBe(
      concurrentMutation.snapshot.expiresAt,
    );
    expect(tournamentRequests).toBe(0);
    expect(codeRequests).toBe(1);
    await replaceParticipantAndAssertRows(result.snapshot);
  });
});

describe("Customs voice recovery", () => {
  test("blocks night shutdown and manual override during arrangement", async () => {
    const created = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: VOICE_GUILD_ID,
      guildName: "Voice guild",
      launchChannelId: VOICE_GUILD_ID,
      voiceLobbyChannelId: VOICE_GUILD_ID,
      now: NOW,
    });
    const seeded = await commitCustomMutation({
      prisma,
      nightId: created.snapshot.id,
      expectedRevision: created.snapshot.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_VOICE_ARRANGEMENT_CLAIMED",
      payload: {},
      update: (snapshot) =>
        CustomNightSnapshotSchema.parse({
          ...snapshot,
          state: "LOBBY_READY",
          currentGame: {
            id: "405fbf72-e1cf-4ec7-801c-ad58b6987b72",
            sequence: 1,
            state: "CODE_PENDING",
            rosterMode: "FIRST_TEN",
            map: "SUMMONERS_RIFT",
            pickMode: "TOURNAMENT_DRAFT",
            participants: Array.from({ length: 10 }, (_, index) =>
              participant(index),
            ),
            activeCaptain: null,
            tournamentCode: null,
            tournamentCodeProvisioning: null,
            voiceArrangementProvisioning: {
              id: "505fbf72-e1cf-4ec7-801c-ad58b6987b72",
              startedAt: NOW.toISOString(),
            },
            riotMatchId: null,
            winner: null,
            resultSource: null,
            resultDisagreement: false,
            repeatChampionWarnings: [],
            voiceReady: false,
            voiceOverride: false,
            voiceError: null,
            createdAt: NOW.toISOString(),
            startedAt: null,
            completedAt: null,
          },
        }),
    });
    const actor = { discordId: HOST_ID, discordAdministrator: false };
    const now = new Date(NOW.getTime() + 1000);
    await expect(
      endCustomNight({
        prisma,
        actor,
        nightId: created.snapshot.id,
        expectedRevision: seeded.snapshot.revision,
        now,
      }),
    ).rejects.toThrow(
      "Wait for voice arrangement to finish before ending the night",
    );
    await expect(
      overrideCustomVoice({
        prisma,
        actor,
        nightId: created.snapshot.id,
        expectedRevision: seeded.snapshot.revision,
        now,
      }),
    ).rejects.toThrow(
      "Wait for voice arrangement to finish before continuing manually",
    );
  });
});

describe("Custom Riot result recovery", () => {
  test("retries after an unrelated night revision wins the first commit", async () => {
    const tournamentCode = "RESULT-RACE-CODE";
    const gameId = "705fbf72-e1cf-4ec7-801c-ad58b6987b72";
    const created = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: RESULT_RACE_GUILD_ID,
      guildName: "Result race guild",
      launchChannelId: RESULT_RACE_GUILD_ID,
      voiceLobbyChannelId: RESULT_RACE_GUILD_ID,
      now: NOW,
    });
    const seeded = await commitCustomMutation({
      prisma,
      nightId: created.snapshot.id,
      expectedRevision: created.snapshot.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_GAME_PLAYING",
      payload: {},
      update: (snapshot) =>
        CustomNightSnapshotSchema.parse({
          ...snapshot,
          state: "PLAYING",
          currentGame: {
            id: gameId,
            sequence: 1,
            state: "PLAYING",
            rosterMode: "FIRST_TEN",
            map: "SUMMONERS_RIFT",
            pickMode: "TOURNAMENT_DRAFT",
            participants: Array.from({ length: 10 }, (_, index) =>
              participant(index),
            ),
            activeCaptain: null,
            tournamentCode,
            tournamentCodeProvisioning: null,
            riotMatchId: null,
            winner: null,
            resultSource: null,
            resultDisagreement: false,
            repeatChampionWarnings: [],
            voiceReady: true,
            voiceOverride: false,
            voiceError: null,
            createdAt: NOW.toISOString(),
            startedAt: NOW.toISOString(),
            completedAt: null,
          },
        }),
    });
    expect(seeded.applied).toBe(true);

    let injectedRevision = false;
    const racingPrisma = prisma.$extends({
      query: {
        customGame: {
          async findUnique({ args, query }) {
            if (!injectedRevision) {
              injectedRevision = true;
              const concurrent = await getCustomNight(
                prisma,
                created.snapshot.id,
              );
              if (concurrent === null)
                throw new Error("Custom night not found");
              const revision = await commitCustomMutation({
                prisma,
                nightId: concurrent.id,
                expectedRevision: concurrent.revision,
                actorDiscordId: HOST_ID,
                action: "TEST_CONCURRENT_RESULT_MUTATION",
                payload: {},
                update: (snapshot) => refreshSnapshot(snapshot, new Date()),
              });
              if (!revision.applied)
                throw new Error("Concurrent test mutation was not applied");
            }
            return await query(args);
          },
        },
      },
    });
    const winningPuuid = participant(0).puuid;
    const result = await recordRiotTournamentResult({
      prisma: racingPrisma,
      nightId: created.snapshot.id,
      result: {
        startTime: NOW.getTime(),
        gameId: 1_234_567_890,
        gameName: "Result race",
        gameType: "CUSTOM_GAME",
        gameMap: 11,
        gameMode: "CLASSIC",
        region: "NA1",
        shortCode: tournamentCode,
        winningTeam: [{ puuid: winningPuuid }],
        losingTeam: [{ puuid: participant(5).puuid }],
      },
    });

    expect(injectedRevision).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.snapshot.currentGame?.state).toBe("VERIFIED");
    expect(result.snapshot.currentGame?.riotMatchId).toBe("NA1_1234567890");
    expect(result.snapshot.currentGame?.winner).toBe("A");
    expect(
      await prisma.customAuditEvent.count({
        where: { nightId: created.snapshot.id, action: "RIOT_RESULT_VERIFIED" },
      }),
    ).toBe(1);
    await prisma.customGame.update({
      where: { id: gameId },
      data: { importedAt: new Date() },
    });
  });
});

describe("Custom import recovery", () => {
  test("stores Match-V5 details only on the guild-scoped custom game", async () => {
    const match = await matchFixture();
    const created = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: PRIVATE_MATCH_GUILD_ID,
      guildName: "Private match guild",
      launchChannelId: PRIVATE_MATCH_GUILD_ID,
      voiceLobbyChannelId: PRIVATE_MATCH_GUILD_ID,
      now: NOW,
    });
    const gameId = "605fbf72-e1cf-4ec7-801c-ad58b6987b72";
    const gameParticipants = match.info.participants.map(
      (matchParticipant, index) => ({
        ...participant(index),
        puuid: matchParticipant.puuid,
        riotGameName: matchParticipant.riotIdGameName ?? null,
        riotTagLine: matchParticipant.riotIdTagline ?? null,
      }),
    );
    const seeded = await commitCustomMutation({
      prisma,
      nightId: created.snapshot.id,
      expectedRevision: created.snapshot.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_GAME_VERIFIED_FOR_PRIVATE_IMPORT",
      payload: {},
      update: (snapshot) =>
        CustomNightSnapshotSchema.parse({
          ...snapshot,
          state: "INTERMISSION",
          currentGame: {
            id: gameId,
            sequence: 1,
            state: "VERIFIED",
            rosterMode: "FIRST_TEN",
            map: "SUMMONERS_RIFT",
            pickMode: "TOURNAMENT_DRAFT",
            participants: gameParticipants,
            activeCaptain: null,
            tournamentCode: null,
            tournamentCodeProvisioning: null,
            riotMatchId: match.metadata.matchId,
            winner: "A",
            resultSource: "RIOT",
            resultDisagreement: false,
            repeatChampionWarnings: [],
            voiceReady: true,
            voiceOverride: false,
            voiceError: null,
            createdAt: NOW.toISOString(),
            startedAt: NOW.toISOString(),
            completedAt: NOW.toISOString(),
          },
        }),
    });
    expect(seeded.applied).toBe(true);

    const imported = await importCustomMatchDetails({
      prisma,
      gameId,
      fetcher: async () => match,
    });
    expect(imported?.applied).toBe(true);
    const stored = await prisma.customGame.findUniqueOrThrow({
      where: { id: gameId },
    });
    expect(stored.importedAt).not.toBeNull();
    if (stored.matchSnapshot === null)
      throw new Error("Expected a private Match-V5 snapshot");
    expect(
      RawMatchSchema.parse(JSON.parse(stored.matchSnapshot)).metadata.matchId,
    ).toBe(match.metadata.matchId);
  });

  test("retries verified imports after the active-night pointer is removed", async () => {
    const created = await createCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      guildId: ENDED_GUILD_ID,
      guildName: "Ended guild",
      launchChannelId: ENDED_GUILD_ID,
      voiceLobbyChannelId: ENDED_GUILD_ID,
      now: NOW,
    });
    const gameId = "205fbf72-e1cf-4ec7-801c-ad58b6987b72";
    const completedAt = new Date(NOW.getTime() + 1000);
    const seeded = await commitCustomMutation({
      prisma,
      nightId: created.snapshot.id,
      expectedRevision: created.snapshot.revision,
      actorDiscordId: HOST_ID,
      action: "TEST_GAME_VERIFIED",
      payload: {},
      update: (snapshot) =>
        CustomNightSnapshotSchema.parse({
          ...snapshot,
          state: "INTERMISSION",
          currentGame: {
            id: gameId,
            sequence: 1,
            state: "VERIFIED",
            rosterMode: "FIRST_TEN",
            map: "SUMMONERS_RIFT",
            pickMode: "TOURNAMENT_DRAFT",
            participants: Array.from({ length: 10 }, (_, index) =>
              participant(index),
            ),
            activeCaptain: null,
            tournamentCode: "ENDED-TOURNAMENT-CODE",
            tournamentCodeProvisioning: null,
            riotMatchId: "NA1_1234567890",
            winner: "A",
            resultSource: "RIOT",
            resultDisagreement: false,
            repeatChampionWarnings: [],
            voiceReady: true,
            voiceOverride: false,
            voiceError: null,
            createdAt: NOW.toISOString(),
            startedAt: NOW.toISOString(),
            completedAt: completedAt.toISOString(),
          },
        }),
    });
    const ended = await endCustomNight({
      prisma,
      actor: { discordId: HOST_ID, discordAdministrator: false },
      nightId: created.snapshot.id,
      expectedRevision: seeded.snapshot.revision,
      now: new Date(completedAt.getTime() + 1000),
    });
    expect(ended.applied).toBe(true);
    expect(
      await prisma.customActiveNight.findUnique({
        where: { guildId: ENDED_GUILD_ID },
      }),
    ).toBeNull();

    const importedGameIds: string[] = [];
    await retryPendingCustomImports(prisma, async ({ gameId: pendingId }) => {
      importedGameIds.push(pendingId);
      return null;
    });
    expect(importedGameIds).toEqual([gameId]);
  });
});
