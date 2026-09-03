import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { deliverPendingDareNotifications } from "#src/betting/dare-notification-delivery.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dare-notification-outbox.ts";
import {
  getBucksNotificationPreferences,
  updateBucksNotificationPreferences,
} from "#src/betting/notification-preferences.ts";
import { client } from "#src/discord/client.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const { prisma: db } = createTestDatabase("dare-notification-outbox");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = bucksTestDiscordId(61);
const TARGET = bucksTestDiscordId(62);
const NOW = new Date("2026-09-03T00:00:00.000Z");

async function seedDare(): Promise<number> {
  const dare = await db.bucksDareV2.create({
    data: {
      serverId: SERVER,
      channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
      challengerDiscordId: CHALLENGER,
      openingStake: 10,
    },
  });
  await db.bucksDareV2Target.createMany({
    data: [
      {
        dareId: dare.id,
        targetKey: "challenger-too",
        discordId: CHALLENGER,
        playerId: PlayerIdSchema.parse(1),
        alias: "challenger",
        accounts: "[]",
      },
      {
        dareId: dare.id,
        targetKey: "target",
        discordId: TARGET,
        playerId: PlayerIdSchema.parse(2),
        alias: "target",
        accounts: "[]",
      },
    ],
  });
  return dare.id;
}

async function enqueue(dareId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await enqueueDareNotificationInTransaction(tx, {
      dareId,
      revision: 1,
      category: "progress",
      kind: "advanced",
      matchId: "NA1_NOTIFICATION",
      summary: "One win remains.",
      deduplicationKey: `test:${dareId.toString()}:advance`,
      occurredAt: NOW,
    });
  });
}

beforeEach(async () => {
  await db.bucksDareNotificationDelivery.deleteMany();
  await db.bucksDareNotificationEvent.deleteMany();
  await db.bucksNotificationPreference.deleteMany();
  await db.bucksDareV2Target.deleteMany();
  await db.bucksDareV2.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Dare notification outbox", () => {
  test("freezes and deduplicates involved recipients transactionally", async () => {
    const dareId = await seedDare();
    await enqueue(dareId);
    await enqueue(dareId);

    const event = await db.bucksDareNotificationEvent.findMany({
      include: { deliveries: { orderBy: { discordId: "asc" } } },
    });
    expect(event).toHaveLength(1);
    expect(event[0]?.deliveries.map((row) => row.discordId)).toEqual(
      [CHALLENGER, TARGET].toSorted(),
    );
  });

  test("checks the current preference and records suppression", async () => {
    const dareId = await seedDare();
    await enqueue(dareId);
    await updateBucksNotificationPreferences(
      {
        serverId: SERVER,
        discordId: TARGET,
        updates: { dareProgressDms: false },
      },
      db,
    );
    const sendDm = vi.fn(async () => "sent" as const);
    await deliverPendingDareNotifications(
      db,
      {
        client,
        isPolicyEnabled: async () => true,
        getPreferences: getBucksNotificationPreferences,
        sendDm,
      },
      NOW,
    );

    const rows = await db.bucksDareNotificationDelivery.findMany({
      orderBy: { discordId: "asc" },
    });
    expect(rows.map((row) => [row.discordId, row.deliveryState])).toEqual([
      [CHALLENGER, "sent"],
      [TARGET, "suppressed"],
    ]);
    expect(sendDm).toHaveBeenCalledTimes(1);
  });

  test("leaves transient failures retryable without affecting recipients", async () => {
    const dareId = await seedDare();
    await enqueue(dareId);
    const sendDm = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("sent");
    const dependencies = {
      client,
      isPolicyEnabled: async () => true,
      getPreferences: getBucksNotificationPreferences,
      sendDm,
    };
    await deliverPendingDareNotifications(db, dependencies, NOW);
    const retry = await db.bucksDareNotificationDelivery.findFirstOrThrow({
      where: { deliveryState: "retry" },
    });
    expect(retry.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60 * 1000));

    await deliverPendingDareNotifications(
      db,
      dependencies,
      new Date(NOW.getTime() + 60 * 1000),
    );
    await expect(
      db.bucksDareNotificationDelivery.count({
        where: { deliveryState: "sent" },
      }),
    ).resolves.toBe(2);
  });

  test("isolates recipients but propagates unexpected delivery failures", async () => {
    const dareId = await seedDare();
    await enqueue(dareId);
    const getPreferences = vi
      .fn()
      .mockRejectedValueOnce(new Error("preference store unavailable"))
      .mockImplementation(getBucksNotificationPreferences);
    const sendDm = vi.fn(async () => "sent" as const);

    await expect(
      deliverPendingDareNotifications(
        db,
        {
          client,
          isPolicyEnabled: async () => true,
          getPreferences,
          sendDm,
        },
        NOW,
      ),
    ).rejects.toThrow("1 Dare notification delivery operation(s) failed.");
    expect(getPreferences).toHaveBeenCalledTimes(2);
    expect(sendDm).toHaveBeenCalledTimes(1);
  });
});
