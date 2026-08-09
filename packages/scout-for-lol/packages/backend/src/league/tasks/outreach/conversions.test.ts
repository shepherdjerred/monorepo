import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { recordConversionIfAny } from "#src/league/tasks/outreach/conversions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("outreach-conversions-test");

const SERVER_ID = testGuildId("111000000000000091");
const RECIPIENT_ID = testAccountId("111000000000000092");
const CHANNEL_ID = testChannelId("111000000000000093");
const INSTALLED_AT = new Date("2026-08-01T00:00:00.000Z");
const DELIVERED_AT = new Date("2026-08-02T00:00:00.000Z");
const CONVERTED_AT = new Date("2026-08-03T00:00:00.000Z");

beforeEach(async () => {
  await prisma.outreachConversion.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.player.deleteMany();
  await prisma.dmAuditLog.deleteMany();

  const player = await prisma.player.create({
    data: {
      alias: "conversion-test-player",
      serverId: SERVER_ID,
      creatorDiscordId: RECIPIENT_ID,
      createdTime: CONVERTED_AT,
      updatedTime: CONVERTED_AT,
    },
  });
  await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId: CHANNEL_ID,
      serverId: SERVER_ID,
      creatorDiscordId: RECIPIENT_ID,
      createdTime: CONVERTED_AT,
      updatedTime: CONVERTED_AT,
    },
  });
  await prisma.dmAuditLog.create({
    data: {
      recipientId: RECIPIENT_ID,
      guildId: SERVER_ID,
      kind: "outreach_nudge",
      content: "Message 1 of 3",
      deliveryStatus: "sent",
      ladderStage: 1,
      createdAt: DELIVERED_AT,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordConversionIfAny", () => {
  test("is idempotent when concurrent writers record the same install", async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () =>
        recordConversionIfAny(prisma, SERVER_ID, INSTALLED_AT),
      ),
    );

    const conversions = await prisma.outreachConversion.findMany({
      select: {
        serverId: true,
        installedAt: true,
        ladderStage: true,
      },
    });
    expect(conversions).toEqual([
      {
        serverId: SERVER_ID,
        installedAt: INSTALLED_AT,
        ladderStage: 1,
      },
    ]);
  });
});
