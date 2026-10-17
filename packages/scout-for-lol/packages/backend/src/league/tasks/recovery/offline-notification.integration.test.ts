import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { DiscordChannelId, DiscordGuildId } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import { productAnnouncementOf } from "#src/temporal/notification/product/announcement.ts";
import { sendOfflineNotification } from "#src/league/tasks/recovery/offline-notification.ts";

const { prisma: db } = createTestDatabase("offline-notification");
const GUILD = testGuildId("8410");
const OTHER_GUILD = testGuildId("8411");
const CHANNEL = testChannelId("8412");
const OTHER_CHANNEL = testChannelId("8413");
const OUTAGE = new Date("2026-10-01T00:00:00.000Z");

async function subscribe(
  serverId: DiscordGuildId,
  channelId: DiscordChannelId,
  alias: string,
  accountId: string,
): Promise<void> {
  const now = new Date();
  const player = await db.player.create({
    data: {
      alias,
      discordId: testAccountId(accountId),
      serverId,
      creatorDiscordId: testAccountId("8499"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.subscription.create({
    data: {
      playerId: player.id,
      channelId,
      serverId,
      creatorDiscordId: testAccountId("8499"),
      createdTime: now,
      updatedTime: now,
    },
  });
}

beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.scoutWorkflowStart.deleteMany();
  await db.subscription.deleteMany();
  await db.player.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("the offline recovery notice", () => {
  test("mints one durable product announcement per subscribed channel", async () => {
    await subscribe(GUILD, CHANNEL, "first", "8401");
    // A second player in the same channel must not double the notice.
    await subscribe(GUILD, CHANNEL, "second", "8402");
    await subscribe(OTHER_GUILD, OTHER_CHANNEL, "third", "8403");

    await sendOfflineNotification(OUTAGE, db);

    const rows = await db.matchNotificationIntent.findMany({
      orderBy: { targetId: "asc" },
    });
    expect(rows.map((row) => row.targetId)).toEqual(
      [CHANNEL, OTHER_CHANNEL].toSorted(),
    );
    expect(
      rows.every(
        (row) =>
          row.kind === "product-announcement" && row.targetKind === "channel",
      ),
    ).toBe(true);
    for (const row of rows) {
      const record = notificationIntentRowToRecord(row);
      if (!("announcementId" in record))
        throw new Error("Expected a product announcement subject");
      expect(productAnnouncementOf(record)).toMatchObject({
        announcementId: `offline-recovery:${OUTAGE.toISOString()}`,
        guildId: row.targetId === CHANNEL ? GUILD : OTHER_GUILD,
        effect: {
          kind: "offline-recovery",
          outageStartedAt: OUTAGE.toISOString(),
        },
      });
    }
    // Each intent's delivery is requested in the same transaction.
    expect(
      await db.scoutWorkflowStart.count({
        where: { requestSource: "product-announcement:offline-recovery" },
      }),
    ).toBe(2);
  });

  test("a repeat recovery pass for the same outage posts nothing new", async () => {
    await subscribe(GUILD, CHANNEL, "first", "8401");

    await sendOfflineNotification(OUTAGE, db);
    await sendOfflineNotification(OUTAGE, db);

    expect(await db.matchNotificationIntent.count()).toBe(1);
    expect(await db.scoutWorkflowStart.count()).toBe(1);
  });

  test("a later outage is its own notice", async () => {
    await subscribe(GUILD, CHANNEL, "first", "8401");

    await sendOfflineNotification(OUTAGE, db);
    await sendOfflineNotification(
      new Date(OUTAGE.getTime() + 7 * 86_400_000),
      db,
    );

    expect(await db.matchNotificationIntent.count()).toBe(2);
  });
});
