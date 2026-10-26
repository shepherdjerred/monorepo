import {
  getSubjectIntent,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import { reserveBudgetedDm } from "#src/discord/utils/dm-budget.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import {
  mintProductAnnouncement,
  productAnnouncementIntentKey,
  productAnnouncementOf,
} from "#src/temporal/notification/product/announcement.ts";
import { repairProductAnnouncementFollowUps } from "#src/temporal/notification/product/follow-up.ts";
import {
  orchestrationMode,
  withOrchestrationProducer,
} from "#src/temporal/orchestration-cutover.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { expire } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const { prisma: db } = createTestDatabase("product-announcement");
const guildId = testGuildId("8310");
const accountId = testAccountId("8311");
const now = new Date();
const at = IsoInstantSchema.parse(now.toISOString());

beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.scoutWorkflowStart.deleteMany();
  await db.bucksWeeklyPublication.deleteMany();
  await db.bucksWeeklyLeaderboardSnapshot.deleteMany();
  await db.dmAuditLog.deleteMany();
  await db.scoutOrchestrationCutover.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("durable product announcements", () => {
  test("activation drains an in-flight legacy producer before any durable producer can enter", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const legacy = withOrchestrationProducer(
      async () => {
        expect(await orchestrationMode(db, async () => true)).toBe("legacy");
        entered?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        events.push("legacy-finished");
      },
      db,
      async () => false,
    );
    await ready;
    const durable = withOrchestrationProducer(
      async () => {
        events.push("durable-entered");
        expect(await orchestrationMode(db, async () => false)).toBe("durable");
      },
      db,
      async () => true,
    );
    await vi.waitFor(async () => {
      const [row] = await db.$queryRaw<
        { waiting: number }[]
      >`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = hashtext('scout-v2-effect')::oid AND objid = hashtext('scout-temporal-durability-v1')::oid`;
      expect(row?.waiting).toBe(1);
    });
    expect(await db.scoutOrchestrationCutover.count()).toBe(0);
    if (release === undefined)
      throw new Error("Expected a legacy producer awaiting release");
    release();
    await Promise.all([legacy, durable]);
    expect(events).toEqual(["legacy-finished", "durable-entered"]);
    expect(
      await withOrchestrationProducer(
        async () => await orchestrationMode(db),
        db,
        async () => false,
      ),
    ).toBe("paused");
  });

  test("cutover is monotonic: disabling the flag pauses rather than restoring direct sends", async () => {
    expect(await orchestrationMode(db, async () => false)).toBe("legacy");
    expect(await orchestrationMode(db, async () => true)).toBe("durable");
    expect(await orchestrationMode(db, async () => true)).toBe("durable");
    expect(await orchestrationMode(db, async () => false)).toBe("paused");
    expect(await db.scoutOrchestrationCutover.count()).toBe(1);
  });

  test("a failed occurrence commit cannot strand a reservation or a start request", async () => {
    await expect(
      db.$transaction(async (tx) => {
        const reservation = await reserveBudgetedDm(tx, {
          recipientId: accountId,
          guildId,
          kind: "outreach_nudge",
          message: "hello",
          budget: {
            guildId,
            serverName: "Test",
            installedAt: new Date(0),
            ladderStage: 1,
          },
        });
        if (reservation.status !== "reserved")
          throw new Error("Unexpected budget refusal");
        await mintProductAnnouncement(tx, {
          announcementId: "rollback",
          guildId,
          target: { kind: "dm", accountId },
          message: { content: reservation.message },
          effect: {
            kind: "outreach",
            auditId: reservation.id,
            installedAt: at,
            ladderStage: 1,
          },
          occurredAt: now,
          freshnessDeadline: new Date(now.getTime() + 60_000),
        });
        throw new Error("Injected failure after outbox write");
      }),
    ).rejects.toThrow("Injected failure");
    expect(await db.dmAuditLog.count()).toBe(0);
    expect(await db.matchNotificationIntent.count()).toBe(0);
    expect(await db.scoutWorkflowStart.count()).toBe(0);
  });
});

describe("durable publication and DM recovery", () => {
  test("uncertain DMs retain their reservation and never send automatically again", async () => {
    const reservation = await db.$transaction(
      async (tx) =>
        await reserveBudgetedDm(tx, {
          recipientId: accountId,
          guildId,
          kind: "outreach_nudge",
          message: "hello",
          budget: { guildId, serverName: "Test", installedAt: new Date(0) },
        }),
    );
    if (reservation.status !== "reserved")
      throw new Error("Unexpected budget refusal");
    const delivery = vi.fn(async () => {
      throw new Error("Acknowledgement lost after request");
    });
    const options = {
      userId: accountId,
      guildId,
      kind: "outreach_nudge" as const,
      message: reservation.message,
      reservationId: reservation.id,
      prisma: db,
      delivery,
    };
    expect(await sendDM(options)).toBe("unknown");
    expect(await sendDM(options)).toBe("unknown");
    expect(delivery).toHaveBeenCalledTimes(1);
    expect(await readOutreachState(db, guildId, new Date(0))).toMatchObject({
      spent: 1,
    });
  });

  test("expired unsent outreach releases its reservation during maintenance", async () => {
    const target = { kind: "dm" as const, accountId };
    await db.$transaction(async (tx) => {
      const reservation = await reserveBudgetedDm(tx, {
        recipientId: accountId,
        guildId,
        kind: "outreach_nudge",
        message: "hello",
        budget: { guildId, serverName: "Test", installedAt: new Date(0) },
      });
      if (reservation.status !== "reserved")
        throw new Error("Unexpected budget refusal");
      await mintProductAnnouncement(tx, {
        announcementId: "expire",
        guildId,
        target,
        message: { content: reservation.message },
        effect: {
          kind: "outreach",
          auditId: reservation.id,
          installedAt: at,
          ladderStage: 1,
        },
        occurredAt: now,
        freshnessDeadline: now,
      });
    });
    const intentKey = productAnnouncementIntentKey("expire", target);
    const record = await getSubjectIntent(db, { intentKey });
    if (record === null || !("announcementId" in record))
      throw new Error("Expected product intent");
    expect(productAnnouncementOf(record).announcementId).toBe("expire");
    await transitionIntent(db, { intentKey, transition: expire });
    await repairProductAnnouncementFollowUps(db);
    expect(await readOutreachState(db, guildId, new Date(0))).toMatchObject({
      spent: 0,
    });
  });
});
