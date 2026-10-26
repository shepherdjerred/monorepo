import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type DiscordMessageId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { beforeEach, expect, test, vi } from "vitest";
const { prisma } = createTestDatabase("scout-prematch-follow-up");
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
const recordOutput = vi.hoisted(() => vi.fn());
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputsDelivered: recordOutput,
}));
const { afterPrematchDelivered } =
  await import("#src/temporal/notification/prematch-follow-up.ts");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_8100000001");
const GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNEL = DiscordChannelIdSchema.parse("800000000000000001");
function delivered(
  channelId: DiscordChannelId,
  messageId: DiscordMessageId,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: {
      key: NotificationIntentKeySchema.parse(
        `prematch-discord:${MATCH_ID}:${channelId}`,
      ),
      kind: "prematch",
      origin: { kind: "live" },
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(channelId),
      },
      freshnessDeadline: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"),
      createdAt: IsoInstantSchema.parse("2026-09-25T00:00:00.000Z"),
      attemptCount: 1,
      state: {
        kind: "delivered",
        messageId: DiscordMessageIdSchema.parse(messageId),
        deliveredAt: IsoInstantSchema.parse("2026-09-25T00:00:05.000Z"),
      },
    },
  };
}

beforeEach(async () => {
  recordOutput.mockClear();
  await prisma.subscription.deleteMany();
  await prisma.player.deleteMany();
});
test("counts a confirmed prematch output for its subscribed guild", async () => {
  const actor = DiscordAccountIdSchema.parse("16050917270473909");
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: "jerred",
      discordId: actor,
      serverId: GUILD,
      creatorDiscordId: actor,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId: CHANNEL,
      serverId: GUILD,
      creatorDiscordId: actor,
      createdTime: now,
      updatedTime: now,
    },
  });
  expect(
    await afterPrematchDelivered(
      delivered(CHANNEL, DiscordMessageIdSchema.parse("900000000000000001")),
    ),
  ).toEqual({ outcome: "completed" });
  expect(recordOutput).toHaveBeenCalledWith([GUILD], "prematch");
});
test("does not count a removed subscription or an unconfirmed delivery", async () => {
  const record = delivered(
    CHANNEL,
    DiscordMessageIdSchema.parse("900000000000000001"),
  );
  expect(await afterPrematchDelivered(record)).toEqual({ outcome: "skipped" });
  expect(
    await afterPrematchDelivered({
      ...record,
      intent: { ...record.intent, state: { kind: "ready" } },
    }),
  ).toEqual({ outcome: "skipped" });
  expect(recordOutput).not.toHaveBeenCalled();
});
