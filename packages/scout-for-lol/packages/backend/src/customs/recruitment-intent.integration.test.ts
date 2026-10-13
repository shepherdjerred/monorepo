import { afterAll, beforeEach, expect, test } from "vitest";
import {
  IsoInstantSchema,
  DiscordMessageIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  markReady,
  recordFailure,
  recordUnknownDelivery,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { createCustomNight } from "#src/customs/repository.ts";
import { mintCustomRecruitment } from "#src/customs/recruitment-intent.ts";
import {
  getSubjectIntent,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import {
  productAnnouncementIntentKey,
  productAnnouncementOf,
} from "#src/temporal/notification/product/announcement.ts";
import { repairProductAnnouncementFollowUps } from "#src/temporal/notification/product/follow-up.ts";

const { prisma: db } = createTestDatabase("custom-recruitment-reissue");
const now = new Date();
const at = IsoInstantSchema.parse(now.toISOString());
const nonce = NotificationAttemptNonceSchema.parse("recruitment-test-attempt");
const channelId = testChannelId("8701");
beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.scoutWorkflowStart.deleteMany();
  await clearCustomsTestData(db);
});
afterAll(async () => await db.$disconnect());

async function seed() {
  const night = await createCustomNight(db, {
    guildId: testGuildId("8700"),
    guildName: "Recruitment Test",
    launchChannelId: channelId,
    voiceLobbyChannelId: channelId,
    hostDiscordId: testAccountId("8702"),
    hostDisplayName: "Host",
    hostAvatarUrl: undefined,
    disclosureVersion: "2026-08-29",
    now,
    durableRecruitment: true,
  });
  const key = productAnnouncementIntentKey(
    `customs-recruitment:${night.id}:0`,
    { kind: "channel", channelId },
  );
  return { night, key };
}
async function begin(key: ReturnType<typeof productAnnouncementIntentKey>) {
  await transitionIntent(db, { intentKey: key, transition: markReady });
  await transitionIntent(db, {
    intentKey: key,
    transition: (intent) =>
      beginSend(intent, { attemptNonce: nonce, startedAt: at }),
  });
}

test.each(["permission-denied", "target-not-found"] as const)(
  "a confirmed %s failure permits one new recruitment generation",
  async (reason) => {
    const { night, key } = await seed();
    await begin(key);
    await transitionIntent(db, {
      intentKey: key,
      transition: (intent) =>
        recordFailure(intent, {
          attemptNonce: nonce,
          failure: { classification: "terminal", reason },
        }),
    });
    await Promise.all(
      [1, 2].map(
        async () =>
          await db.$transaction(
            async (tx) => await mintCustomRecruitment(tx, night.id, now),
          ),
      ),
    );
    const updated = await db.customNight.findUniqueOrThrow({
      where: { id: night.id },
    });
    expect(updated.recruitmentGeneration).toBe(1);
    expect(updated.revision).toBe(1);
    const replacementKey = productAnnouncementIntentKey(
      `customs-recruitment:${night.id}:1`,
      { kind: "channel", channelId },
    );
    const replacement = await getSubjectIntent(db, {
      intentKey: replacementKey,
    });
    if (replacement === null || !("announcementId" in replacement))
      throw new Error("Expected replacement intent");
    expect(replacement.intent.state.kind).toBe("pending");
    expect(productAnnouncementOf(replacement).effect).toEqual({
      kind: "customs-recruitment",
      nightId: night.id,
      generation: 1,
    });
    const original = await getSubjectIntent(db, { intentKey: key });
    expect(original?.intent.state.kind).toBe("permission-denied");
    expect(await db.matchNotificationIntent.count()).toBe(2);
    expect(await db.scoutWorkflowStart.count()).toBe(2);
    expect(
      await db.customAuditEvent.count({
        where: { action: "RECRUITMENT_REISSUED" },
      }),
    ).toBe(1);
    await begin(replacementKey);
    await transitionIntent(db, {
      intentKey: replacementKey,
      transition: (intent) =>
        confirmDelivered(intent, {
          attemptNonce: nonce,
          deliveredAt: at,
          messageId: DiscordMessageIdSchema.parse("100000000000008703"),
        }),
    });
    await repairProductAnnouncementFollowUps(db);
    expect(
      await db.customNight.findUnique({ where: { id: night.id } }),
    ).toMatchObject({
      recruitmentMessageId: "100000000000008703",
      recruitmentGeneration: 1,
    });
  },
);

test.each([
  "pending",
  "sending",
  "unknown-delivery",
  "delivered",
  "content-unavailable",
] as const)("%s recruitment is never automatically replaced", async (state) => {
  const { night, key } = await seed();
  if (state !== "pending") await begin(key);
  if (state === "delivered")
    await transitionIntent(db, {
      intentKey: key,
      transition: (intent) =>
        confirmDelivered(intent, {
          attemptNonce: nonce,
          deliveredAt: at,
          messageId: DiscordMessageIdSchema.parse("100000000000008703"),
        }),
    });
  if (state === "content-unavailable")
    await transitionIntent(db, {
      intentKey: key,
      transition: (intent) =>
        recordFailure(intent, {
          attemptNonce: nonce,
          failure: {
            classification: "terminal",
            reason: "content-unavailable",
          },
        }),
    });
  if (state === "unknown-delivery")
    await transitionIntent(db, {
      intentKey: key,
      transition: (intent) =>
        recordUnknownDelivery(intent, { attemptNonce: nonce, observedAt: at }),
    });
  await db.$transaction(
    async (tx) => await mintCustomRecruitment(tx, night.id, now),
  );
  expect(await db.matchNotificationIntent.count()).toBe(1);
  expect(await db.scoutWorkflowStart.count()).toBe(1);
  expect(
    await db.customNight.findUnique({ where: { id: night.id } }),
  ).toMatchObject({ recruitmentGeneration: 0 });
});

test("a failed replacement transaction preserves the original generation and its terminal receipt", async () => {
  const { night, key } = await seed();
  await begin(key);
  await transitionIntent(db, {
    intentKey: key,
    transition: (intent) =>
      recordFailure(intent, {
        attemptNonce: nonce,
        failure: { classification: "terminal", reason: "permission-denied" },
      }),
  });
  await expect(
    db.$transaction(async (tx) => {
      await mintCustomRecruitment(tx, night.id, now);
      throw new Error("Injected replacement commit failure");
    }),
  ).rejects.toThrow("Injected replacement commit failure");
  expect(await db.matchNotificationIntent.count()).toBe(1);
  expect(await db.scoutWorkflowStart.count()).toBe(1);
  expect(
    await db.customNight.findUnique({ where: { id: night.id } }),
  ).toMatchObject({ recruitmentGeneration: 0, revision: 0 });
  expect(
    await db.customAuditEvent.count({
      where: { action: "RECRUITMENT_REISSUED" },
    }),
  ).toBe(0);
});
