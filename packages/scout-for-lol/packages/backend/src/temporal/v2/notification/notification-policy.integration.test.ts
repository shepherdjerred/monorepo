import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type RecoveryBatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationIntentSchema,
  type NotificationIntentOrigin,
  type NotificationTarget,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { RecoveryPolicy } from "@scout-for-lol/domain/recovery/batch.ts";
import { operatorReleasePolicy } from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  createRecoveryBatch,
  transitionRecoveryBatch,
} from "#src/database/durable/recovery-repository.ts";

/**
 * The policy gate against real batch rows.
 *
 * The resolver reads the module-level Prisma singleton, so the singleton is
 * pointed at this file's own database before anything that reaches it is
 * imported — the same arrangement `notification-transitions.integration.test.ts`
 * uses, and for the same reason: a dependency-injection seam added for a test
 * would not be the code that runs in production.
 */
const testDatabase = createTestDatabase("temporal-v2-notification-policy");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { resolveNotificationGateV2 } =
  await import("#src/temporal/v2/notification/notification-policy.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const MATCH_ID = RiotMatchIdSchema.parse("NA1_8300");
const ACCOUNT_ID = DiscordAccountIdSchema.parse("200000000000000002");

function record(args: {
  key: string;
  origin: NotificationIntentOrigin;
  target?: NotificationTarget;
}): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(args.key),
      kind: "postmatch",
      origin: args.origin,
      target: args.target ?? {
        kind: "channel",
        channelId: testChannelId("8300"),
      },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-12T10:00:00.000Z",
      attemptCount: 0,
      state: { kind: "ready" },
    }),
  };
}

async function seedBatch(
  name: string,
  policy: RecoveryPolicy,
): Promise<RecoveryBatchId> {
  const recoveryBatchId = RecoveryBatchIdSchema.parse(`policy-${name}`);
  expect(
    await createRecoveryBatch(prisma, {
      batch: {
        id: recoveryBatchId,
        policy,
        createdAt: IsoInstantSchema.parse("2026-09-12T09:00:00.000Z"),
        state: { kind: "planned" },
      },
      workflowId: null,
    }),
  ).toEqual({ outcome: "applied" });
  return recoveryBatchId;
}

describe("resolveNotificationGateV2", () => {
  test("a live intent is delivered under the normal policy", async () => {
    expect(
      await resolveNotificationGateV2(
        record({ key: "gate:live", origin: { kind: "live" } }),
      ),
    ).toEqual({
      kind: "postmatch",
      target: "channel",
      policy: "normal",
      decision: "permitted",
    });
  });

  test("a recovery-born intent is delivered under its batch's policy", async () => {
    const recoveryBatchId = await seedBatch("no-external", "no-external");

    const channel = await resolveNotificationGateV2(
      record({
        key: "gate:no-external:channel",
        origin: { kind: "recovery", recoveryBatchId },
      }),
    );
    const dm = await resolveNotificationGateV2(
      record({
        key: "gate:no-external:dm",
        origin: { kind: "recovery", recoveryBatchId },
        target: { kind: "dm", accountId: ACCOUNT_ID },
      }),
    );

    // `no-external` permits no external send of any shape.
    expect(channel).toMatchObject({ policy: "no-external", decision: "held" });
    expect(dm).toMatchObject({ policy: "no-external", decision: "held" });
  });

  test("stale-private-only permits the DM and holds the channel", async () => {
    const recoveryBatchId = await seedBatch(
      "stale-private",
      "stale-private-only",
    );

    expect(
      await resolveNotificationGateV2(
        record({
          key: "gate:stale:dm",
          origin: { kind: "recovery", recoveryBatchId },
          target: { kind: "dm", accountId: ACCOUNT_ID },
        }),
      ),
    ).toMatchObject({ target: "dm", decision: "permitted" });
    expect(
      await resolveNotificationGateV2(
        record({
          key: "gate:stale:channel",
          origin: { kind: "recovery", recoveryBatchId },
        }),
      ),
    ).toMatchObject({ target: "channel", decision: "held" });
  });

  test("an operator release on the batch is what lets a held DM proceed", async () => {
    // The policy is read off the batch row, never copied onto the intent, so
    // the single sanctioned policy change reaches every intent born of the
    // batch at their next read — without anyone rewriting the intents.
    const recoveryBatchId = await seedBatch("released", "no-external");
    const held = record({
      key: "gate:released:dm",
      origin: { kind: "recovery", recoveryBatchId },
      target: { kind: "dm", accountId: ACCOUNT_ID },
    });
    expect(await resolveNotificationGateV2(held)).toMatchObject({
      decision: "held",
    });

    expect(
      await transitionRecoveryBatch(prisma, {
        recoveryBatchId,
        transition: (batch) =>
          operatorReleasePolicy(batch, { to: "stale-private-only" }),
      }),
    ).toMatchObject({ outcome: "applied" });

    expect(await resolveNotificationGateV2(held)).toEqual({
      kind: "postmatch",
      target: "dm",
      policy: "stale-private-only",
      decision: "permitted",
    });
  });

  test("a recovery-born intent whose batch has no row is a broken contract", async () => {
    await expect(
      resolveNotificationGateV2(
        record({
          key: "gate:orphan",
          origin: {
            kind: "recovery",
            recoveryBatchId: RecoveryBatchIdSchema.parse("policy-nobody"),
          },
        }),
      ),
    ).rejects.toMatchObject({
      type: "MissingDomainRecord",
      nonRetryable: true,
    });
  });
});
