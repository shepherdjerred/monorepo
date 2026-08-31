import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createCustomNight,
  mutateCustomNight,
  type CreateCustomNightInput,
} from "#src/customs/repository.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { anonymizeCustomParticipant } from "#src/customs/anonymize.ts";
import { expireCustomNightsInDatabase } from "#src/customs/expiry.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";

const { prisma: testPrisma } = createTestDatabase("customs-repository");
const NOW = new Date("2026-08-29T12:00:00.000Z");
const CREATE_INPUT: CreateCustomNightInput = {
  guildId: DiscordGuildIdSchema.parse("1337623164146155593"),
  guildName: "Beta Guild",
  launchChannelId: DiscordChannelIdSchema.parse("1337623164146155594"),
  voiceLobbyChannelId: DiscordChannelIdSchema.parse("1337623164146155595"),
  hostDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
  hostDisplayName: "Host",
  hostAvatarUrl: undefined,
  disclosureVersion: "2026-08-29",
  now: NOW,
};

async function endNight(nightId: string, expectedRevision: number) {
  return mutateCustomNight(testPrisma, {
    nightId,
    expectedRevision,
    actorId: CREATE_INPUT.hostDiscordId,
    action: "NIGHT_ENDED",
    payload: {},
    source: "ACTIVITY",
    state: "ENDED",
    now: NOW,
  });
}

beforeEach(async () => {
  await clearCustomsTestData(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("custom night persistence", () => {
  test("PostgreSQL enforces one active night per guild", async () => {
    await createCustomNight(testPrisma, CREATE_INPUT);

    await expect(createCustomNight(testPrisma, CREATE_INPUT)).rejects.toThrow(
      "already has an active custom night",
    );
  });

  test("revision and audit event commit together", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    const revision = await mutateCustomNight(testPrisma, {
      nightId: night.id,
      expectedRevision: 0,
      actorId: CREATE_INPUT.hostDiscordId,
      action: "RECRUITMENT_UPDATED",
      payload: { availability: "READY" },
      source: "ACTIVITY",
      now: NOW,
    });

    expect(revision).toBe(1);
    await expect(
      testPrisma.customAuditEvent.findMany({
        where: { nightId: night.id },
        orderBy: { revision: "asc" },
      }),
    ).resolves.toMatchObject([
      { revision: 0, action: "NIGHT_CREATED" },
      { revision: 1, action: "RECRUITMENT_UPDATED" },
    ]);
  });

  test("expiry atomically ends the night, releases its guild, and audits the transition", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    const expiredAt = new Date(NOW.getTime() + 13 * 60 * 60 * 1000);
    await testPrisma.customNight.update({
      where: { id: night.id },
      data: {
        teamAVoiceChannelId: "team-a",
        teamBVoiceChannelId: "team-b",
      },
    });
    const lobby = await testPrisma.tournamentLobby.create({
      data: {
        code: "EXPIRING-CUSTOMS-CODE",
        apiMode: "live",
        providerId: 1,
        tournamentId: 2,
        region: "AMERICA_NORTH",
        platformId: "NA1",
        serverId: CREATE_INPUT.guildId,
        channelId: CREATE_INPUT.launchChannelId,
        creatorDiscordId: CREATE_INPUT.hostDiscordId,
        bluePuuids: "[]",
        redPuuids: "[]",
        blueAliases: "[]",
        redAliases: "[]",
        teamSize: 5,
        pickType: "TOURNAMENT_DRAFT",
        mapType: "SUMMONERS_RIFT",
        spectatorType: "ALL",
        state: "created",
        expiresAt: expiredAt,
      },
    });
    const game = await testPrisma.customGame.create({
      data: {
        nightId: night.id,
        sequence: 1,
        state: "LOBBY_READY",
        rosterMode: "FIRST_TEN",
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
        tournamentLobbyId: lobby.id,
      },
    });

    const cleaned: string[] = [];
    await expect(
      expireCustomNightsInDatabase(testPrisma, expiredAt, async (nightId) => {
        cleaned.push(nightId);
        await expect(
          testPrisma.customNight.findUniqueOrThrow({ where: { id: nightId } }),
        ).resolves.toMatchObject({ state: "RECRUITING" });
      }),
    ).resolves.toEqual([night.id]);
    expect(cleaned).toEqual([night.id]);
    await expect(
      testPrisma.customNight.findUniqueOrThrow({ where: { id: night.id } }),
    ).resolves.toMatchObject({
      state: "ENDED",
      revision: 1,
      endedAt: expiredAt,
      teamAVoiceChannelId: null,
      teamBVoiceChannelId: null,
    });
    await expect(
      testPrisma.customActiveNight.findUnique({
        where: { guildId: CREATE_INPUT.guildId },
      }),
    ).resolves.toBeNull();
    await expect(
      testPrisma.customAuditEvent.findFirstOrThrow({
        where: { nightId: night.id, action: "NIGHT_EXPIRED" },
      }),
    ).resolves.toMatchObject({ revision: 1, source: "TEMPORAL" });
    await expect(
      testPrisma.customGame.findUniqueOrThrow({ where: { id: game.id } }),
    ).resolves.toMatchObject({
      state: "VOID",
      completedAt: expiredAt,
      voiceState: "CLEANED_UP",
      voiceReady: false,
    });
    await expect(
      testPrisma.tournamentLobby.findUniqueOrThrow({
        where: { id: lobby.id },
      }),
    ).resolves.toMatchObject({ state: "cancelled" });
    await expect(
      testPrisma.customAuditEvent.findFirstOrThrow({
        where: { nightId: night.id, action: "GAME_VOIDED" },
      }),
    ).resolves.toMatchObject({
      gameId: game.id,
      revision: 1,
      source: "TEMPORAL",
    });
    await expect(
      expireCustomNightsInDatabase(testPrisma, expiredAt),
    ).resolves.toEqual([]);
  });

  test("personalized snapshots expose administrator authority and lobby credentials", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    const snapshot = await buildCustomNightSnapshot(
      testPrisma,
      night.id,
      DiscordAccountIdSchema.parse("260509172704739328"),
      { now: NOW, viewerAdministrator: true },
    );

    expect(snapshot?.viewerRole).toBe("ADMIN");
  });

  test("a stale revision changes neither state nor audit", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    await mutateCustomNight(testPrisma, {
      nightId: night.id,
      expectedRevision: 0,
      actorId: CREATE_INPUT.hostDiscordId,
      action: "START_PREPARING",
      payload: {},
      source: "ACTIVITY",
      state: "PREPARING",
      now: NOW,
    });

    await expect(
      mutateCustomNight(testPrisma, {
        nightId: night.id,
        expectedRevision: 0,
        actorId: CREATE_INPUT.hostDiscordId,
        action: "STALE",
        payload: {},
        source: "ACTIVITY",
        now: NOW,
      }),
    ).rejects.toThrow("is stale or ended");
    await expect(
      testPrisma.customAuditEvent.count({ where: { nightId: night.id } }),
    ).resolves.toBe(2);
  });

  test("ending removes the active pointer but retains history", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    await endNight(night.id, 0);

    await expect(
      testPrisma.customActiveNight.findUnique({
        where: { guildId: CREATE_INPUT.guildId },
      }),
    ).resolves.toBeNull();
    await expect(
      testPrisma.customNight.findUniqueOrThrow({ where: { id: night.id } }),
    ).resolves.toMatchObject({ state: "ENDED", revision: 1 });
  });
});

describe("custom-night privacy", () => {
  test("anonymization refuses participants in an active night", async () => {
    await createCustomNight(testPrisma, CREATE_INPUT);
    await expect(
      anonymizeCustomParticipant(testPrisma, {
        guildId: CREATE_INPUT.guildId,
        discordId: CREATE_INPUT.hostDiscordId,
        operatorId: "operator",
      }),
    ).rejects.toThrow("active custom night");
  });

  test("anonymization rewrites participant IDs throughout retained audit payloads", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    const originalPlayerId = PlayerIdSchema.parse(41);
    const originalAccountId = AccountIdSchema.parse(42);
    const originalPuuid = LeaguePuuidSchema.parse("p".repeat(78));
    const game = await testPrisma.customGame.create({
      data: {
        nightId: night.id,
        sequence: 1,
        state: "VOID",
        rosterMode: "FIRST_TEN",
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
        participants: {
          create: {
            discordId: CREATE_INPUT.hostDiscordId,
            displayName: "Host",
            playerId: originalPlayerId,
            playerAlias: "Host",
            accountId: originalAccountId,
            puuid: originalPuuid,
            rosterOrder: 0,
          },
        },
      },
    });
    await mutateCustomNight(testPrisma, {
      nightId: night.id,
      expectedRevision: 0,
      actorId: "operator",
      action: "PARTICIPANT_UPDATED",
      payload: {
        discordId: CREATE_INPUT.hostDiscordId,
        nested: {
          substitutions: [{ outgoingDiscordId: CREATE_INPUT.hostDiscordId }],
        },
      },
      source: "ACTIVITY",
      now: NOW,
    });
    await endNight(night.id, 1);

    const result = await anonymizeCustomParticipant(testPrisma, {
      guildId: CREATE_INPUT.guildId,
      discordId: CREATE_INPUT.hostDiscordId,
      operatorId: CREATE_INPUT.hostDiscordId,
      now: NOW,
    });
    const retainedAudit = await testPrisma.customAuditEvent.findMany({
      where: { nightId: night.id },
      select: { actorId: true, payload: true },
    });
    const retainedParticipant =
      await testPrisma.customGameParticipant.findFirstOrThrow({
        where: { gameId: game.id },
      });

    expect(JSON.stringify(retainedAudit)).not.toContain(
      CREATE_INPUT.hostDiscordId,
    );
    expect(JSON.stringify(retainedAudit)).toContain(result.pseudonym);
    expect(retainedParticipant).toMatchObject({
      discordId: result.pseudonym,
      displayName: "Anonymized player",
      playerAlias: "Anonymized player",
      riotGameName: null,
      riotTagLine: null,
    });
    expect(retainedParticipant.playerId).not.toBe(originalPlayerId);
    expect(retainedParticipant.accountId).not.toBe(originalAccountId);
    expect(retainedParticipant.puuid).not.toBe(originalPuuid);
    expect(retainedParticipant.puuid).toHaveLength(78);
  });

  test("anonymization discovers identities retained only in audit payloads", async () => {
    const auditOnlyDiscordId =
      DiscordAccountIdSchema.parse("260509172704739328");
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    await mutateCustomNight(testPrisma, {
      nightId: night.id,
      expectedRevision: 0,
      actorId: CREATE_INPUT.hostDiscordId,
      action: "PARTICIPANT_REMOVED",
      payload: { discordId: auditOnlyDiscordId },
      source: "ACTIVITY",
      now: NOW,
    });
    await endNight(night.id, 1);

    const result = await anonymizeCustomParticipant(testPrisma, {
      guildId: CREATE_INPUT.guildId,
      discordId: auditOnlyDiscordId,
      operatorId: "operator",
      now: NOW,
    });
    const audit = await testPrisma.customAuditEvent.findMany({
      where: { nightId: night.id },
      select: { payload: true },
    });

    expect(result.nightCount).toBe(1);
    expect(JSON.stringify(audit)).not.toContain(auditOnlyDiscordId);
    expect(JSON.stringify(audit)).toContain(result.pseudonym);
  });

  test("anonymization refuses pending voice cleanup", async () => {
    const night = await createCustomNight(testPrisma, CREATE_INPUT);
    await endNight(night.id, 0);
    await testPrisma.customGame.create({
      data: {
        nightId: night.id,
        sequence: 1,
        state: "VOID",
        rosterMode: "FIRST_TEN",
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
        voiceState: "PROVISIONING",
        participants: {
          create: {
            discordId: CREATE_INPUT.hostDiscordId,
            displayName: "Host",
            playerId: PlayerIdSchema.parse(1),
            playerAlias: "host",
            accountId: AccountIdSchema.parse(1),
            puuid: LeaguePuuidSchema.parse("p".repeat(78)),
            rosterOrder: 0,
          },
        },
      },
    });
    await expect(
      anonymizeCustomParticipant(testPrisma, {
        guildId: CREATE_INPUT.guildId,
        discordId: CREATE_INPUT.hostDiscordId,
        operatorId: "operator",
      }),
    ).rejects.toThrow("voice work is pending");
  });

  test("anonymization merges consent recorded again after an earlier anonymization", async () => {
    const firstNight = await createCustomNight(testPrisma, CREATE_INPUT);
    await endNight(firstNight.id, 0);
    const firstResult = await anonymizeCustomParticipant(testPrisma, {
      guildId: CREATE_INPUT.guildId,
      discordId: CREATE_INPUT.hostDiscordId,
      operatorId: "operator",
      now: NOW,
    });

    const secondNight = await createCustomNight(testPrisma, CREATE_INPUT);
    await endNight(secondNight.id, 0);
    const secondResult = await anonymizeCustomParticipant(testPrisma, {
      guildId: CREATE_INPUT.guildId,
      discordId: CREATE_INPUT.hostDiscordId,
      operatorId: "operator",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(secondResult.pseudonym).toBe(firstResult.pseudonym);
    await expect(
      testPrisma.customConsent.findMany({
        where: { guildId: CREATE_INPUT.guildId },
      }),
    ).resolves.toHaveLength(1);
  });
});
