import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { deliverPendingDareNotifications } from "#src/betting/dares/presentation/notify/dare-notification-delivery.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import {
  getBucksNotificationPreferences,
  updateBucksNotificationPreferences,
} from "#src/betting/notify/notification-preferences.ts";
import { client } from "#src/discord/client.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const { prisma: db } = createTestDatabase("dare-notification-outbox");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = bucksTestDiscordId(61);
const TARGET = bucksTestDiscordId(62);
const LATE_TARGET = bucksTestDiscordId(63);
const NOW = new Date("2026-09-03T00:00:00.000Z");

async function seedDare(): Promise<number> {
  const dare = await db.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
      challengerDiscordId: CHALLENGER,
      openingStake: 10,
    },
  });
  await db.bucksDareTarget.createMany({
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

async function enqueue(
  dareId: number,
  summary = "One win remains.",
): Promise<void> {
  await db.$transaction(async (tx) => {
    await enqueueDareNotificationInTransaction(tx, {
      dareId,
      revision: 1,
      category: "progress",
      kind: "advanced",
      matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
      summary,
      deduplicationKey: `test:${dareId.toString()}:advance`,
      occurredAt: NOW,
    });
  });
}

/** Pre-cutover rows remain owned by the legacy drain. */
async function seedLegacy(dareId: number): Promise<void> {
  const event = await db.bucksDareNotificationEvent.create({
    data: {
      dareId,
      revision: 1,
      category: "progress",
      kind: "advanced",
      matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
      payload: JSON.stringify({
        serverId: SERVER,
        summary: "One win remains.",
      }),
      deduplicationKey: `test:${dareId.toString()}:advance`,
      occurredAt: NOW,
    },
  });
  await db.bucksDareNotificationDelivery.createMany({
    data: [CHALLENGER, TARGET].map((discordId) => ({
      eventId: event.id,
      discordId,
    })),
  });
}

beforeEach(async () => {
  await db.bucksDareNotificationDelivery.deleteMany();
  await db.bucksDareNotificationEvent.deleteMany();
  await db.bucksNotificationPreference.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDare.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Dare notification outbox", () => {
  test("freezes and deduplicates involved recipients transactionally", async () => {
    const dareId = await seedDare();
    await enqueue(dareId);
    await enqueue(dareId);
    await db.bucksDareTarget.create({
      data: {
        dareId,
        targetKey: "late-target",
        discordId: LATE_TARGET,
        playerId: PlayerIdSchema.parse(3),
        alias: "late target",
        accounts: "[]",
      },
    });
    await enqueue(dareId, "Progress changed after the first event.");

    const intents = await db.matchNotificationIntent.findMany({
      where: { subjectKind: "dare", subjectId: dareId.toString() },
      orderBy: { targetId: "asc" },
    });
    expect(intents).toHaveLength(2);
    expect(intents.map((row) => row.targetId)).toEqual(
      [CHALLENGER, TARGET].toSorted(),
    );
    expect(
      intents.every(
        (row) => row.kind === "dare-status" && row.targetKind === "dm",
      ),
    ).toBe(true);
    expect(await db.bucksDareNotificationEvent.count()).toBe(0);
    const first = notificationIntentRowToRecord(intents[0]);
    if (!("dareId" in first) || first.intent.announcement === undefined) {
      throw new Error("Expected a Dare status announcement");
    }
    expect(
      dareStatusAnnouncementCodec.parse(first.intent.announcement),
    ).toMatchObject({
      dareId,
      guildId: SERVER,
      category: "progress",
      kind: "advanced",
      summary: "One win remains.",
    });
    expect(
      await db.scoutWorkflowStart.count({
        where: { requestSource: "dare-status:advanced" },
      }),
    ).toBe(2);
  });

  test("keeps a pre-cutover event as the sole owner", async () => {
    const dareId = await seedDare();
    await seedLegacy(dareId);
    await enqueue(dareId);
    expect(
      await db.matchNotificationIntent.count({
        where: { subjectKind: "dare", subjectId: dareId.toString() },
      }),
    ).toBe(0);
    expect(await db.bucksDareNotificationDelivery.count()).toBe(2);
  });

  test("checks the current preference and records suppression", async () => {
    const dareId = await seedDare();
    await seedLegacy(dareId);
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
    await seedLegacy(dareId);
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
    await seedLegacy(dareId);
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
