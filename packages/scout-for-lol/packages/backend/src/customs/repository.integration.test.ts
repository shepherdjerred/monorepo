import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createCustomNight,
  mutateCustomNight,
  type CreateCustomNightInput,
} from "#src/customs/repository.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";

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
    await mutateCustomNight(testPrisma, {
      nightId: night.id,
      expectedRevision: 0,
      actorId: CREATE_INPUT.hostDiscordId,
      action: "NIGHT_ENDED",
      payload: {},
      source: "ACTIVITY",
      state: "ENDED",
      now: NOW,
    });

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
