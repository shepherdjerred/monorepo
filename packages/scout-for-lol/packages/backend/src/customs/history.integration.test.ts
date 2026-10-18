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
  appendRetainedCustomAudit,
  clearCustomsTestData,
  seedRetainedCustomNight,
  type RetainedCustomNightSeed,
} from "#src/customs/test-database.ts";
import { anonymizeCustomParticipant } from "#src/customs/anonymize.ts";
import {
  buildCustomNightHistory,
  buildCustomNightSnapshot,
} from "#src/customs/snapshot.ts";

const { prisma: testPrisma } = createTestDatabase("customs-history");
const NOW = new Date("2026-08-29T12:00:00.000Z");
const SEED: RetainedCustomNightSeed = {
  guildId: DiscordGuildIdSchema.parse("1337623164146155593"),
  guildName: "Beta Guild",
  launchChannelId: DiscordChannelIdSchema.parse("1337623164146155594"),
  voiceLobbyChannelId: DiscordChannelIdSchema.parse("1337623164146155595"),
  hostDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
  hostDisplayName: "Host",
  disclosureVersion: "2026-08-29",
  now: NOW,
};

async function endNight(nightId: string) {
  await appendRetainedCustomAudit(testPrisma, {
    nightId,
    actorId: SEED.hostDiscordId,
    action: "NIGHT_ENDED",
    payload: {},
    endsNight: true,
    now: NOW,
  });
}

beforeEach(async () => {
  await clearCustomsTestData(testPrisma);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("custom-night history", () => {
  test("personalized snapshots expose administrator authority", async () => {
    const night = await seedRetainedCustomNight(testPrisma, SEED);
    const snapshot = await buildCustomNightSnapshot(
      testPrisma,
      night.id,
      DiscordAccountIdSchema.parse("260509172704739328"),
      { now: NOW, viewerAdministrator: true },
    );

    expect(snapshot?.viewerRole).toBe("ADMIN");
  });

  test("an ended night keeps its games and ordered audit ledger", async () => {
    const night = await seedRetainedCustomNight(testPrisma, SEED);
    await testPrisma.customGame.create({
      data: {
        nightId: night.id,
        sequence: 1,
        state: "VERIFIED",
        rosterMode: "FIRST_TEN",
        map: "SUMMONERS_RIFT",
        pickMode: "TOURNAMENT_DRAFT",
        winner: "A",
      },
    });
    await endNight(night.id);

    const history = await buildCustomNightHistory(
      testPrisma,
      night.id,
      SEED.hostDiscordId,
      NOW,
    );

    expect(history?.night).toMatchObject({ state: "ENDED", revision: 1 });
    expect(history?.games).toMatchObject([
      { sequence: 1, state: "VERIFIED", winner: "A" },
    ]);
    expect(history?.audit.map((event) => event.action)).toEqual([
      "NIGHT_CREATED",
      "NIGHT_ENDED",
    ]);
  });
});

describe("custom-night privacy", () => {
  test("anonymization refuses participants in an active night", async () => {
    await seedRetainedCustomNight(testPrisma, SEED);
    await expect(
      anonymizeCustomParticipant(testPrisma, {
        guildId: SEED.guildId,
        discordId: SEED.hostDiscordId,
        operatorId: "operator",
      }),
    ).rejects.toThrow("active custom night");
  });

  test("anonymization rewrites participant IDs throughout retained audit payloads", async () => {
    const night = await seedRetainedCustomNight(testPrisma, SEED);
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
            discordId: SEED.hostDiscordId,
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
    await appendRetainedCustomAudit(testPrisma, {
      nightId: night.id,
      actorId: "operator",
      action: "PARTICIPANT_UPDATED",
      payload: {
        discordId: SEED.hostDiscordId,
        nested: {
          substitutions: [{ outgoingDiscordId: SEED.hostDiscordId }],
        },
      },
      now: NOW,
    });
    await endNight(night.id);

    const result = await anonymizeCustomParticipant(testPrisma, {
      guildId: SEED.guildId,
      discordId: SEED.hostDiscordId,
      operatorId: SEED.hostDiscordId,
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

    expect(JSON.stringify(retainedAudit)).not.toContain(SEED.hostDiscordId);
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
    const night = await seedRetainedCustomNight(testPrisma, SEED);
    await appendRetainedCustomAudit(testPrisma, {
      nightId: night.id,
      actorId: SEED.hostDiscordId,
      action: "PARTICIPANT_REMOVED",
      payload: { discordId: auditOnlyDiscordId },
      now: NOW,
    });
    await endNight(night.id);

    const result = await anonymizeCustomParticipant(testPrisma, {
      guildId: SEED.guildId,
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
    const night = await seedRetainedCustomNight(testPrisma, SEED);
    await endNight(night.id);
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
            discordId: SEED.hostDiscordId,
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
        guildId: SEED.guildId,
        discordId: SEED.hostDiscordId,
        operatorId: "operator",
      }),
    ).rejects.toThrow("voice work is pending");
  });

  test("anonymization merges consent recorded again after an earlier anonymization", async () => {
    const firstNight = await seedRetainedCustomNight(testPrisma, SEED);
    await endNight(firstNight.id);
    const firstResult = await anonymizeCustomParticipant(testPrisma, {
      guildId: SEED.guildId,
      discordId: SEED.hostDiscordId,
      operatorId: "operator",
      now: NOW,
    });

    const secondNight = await seedRetainedCustomNight(testPrisma, SEED);
    await endNight(secondNight.id);
    const secondResult = await anonymizeCustomParticipant(testPrisma, {
      guildId: SEED.guildId,
      discordId: SEED.hostDiscordId,
      operatorId: "operator",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(secondResult.pseudonym).toBe(firstResult.pseudonym);
    await expect(
      testPrisma.customConsent.findMany({
        where: { guildId: SEED.guildId },
      }),
    ).resolves.toHaveLength(1);
  });
});
