import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { DareTargetBindingV2 } from "@scout-for-lol/data";
import { createDareDraftV2 } from "#src/betting/dares/lifecycle/dare-draft-v2.ts";
import { createDareV2ConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent-consume-v2.ts";
import {
  ensureDareV2Callout,
  refreshPendingDareV2Callouts,
} from "#src/betting/dares/presentation/dare-callout-v2.ts";
import { TWISTED_FATE_SAME_GAME_PLAN } from "#src/betting/dares/dare-v2-test-fixtures.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

/**
 * The silence guarantee, where a Dare callout is concerned.
 *
 * Its own file rather than a section of the Dare v2 lifecycle suite, because
 * it asks a different question of the same code: not "does the callout post
 * correctly" but "does withholding it actually suppress it". The answer turns
 * on durable state that outlives the call — `calloutRefreshPending` — so the
 * assertions are about what a LATER, unrelated scan finds, and that reads
 * badly interleaved with the delivery mechanics.
 */

const { prisma: db } = createTestDatabase("bucks-dare-v2-callout-silence");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const T0 = new Date("2026-09-01T12:00:00.000Z");

const TARGET_BINDING: DareTargetBindingV2 = {
  key: "virmel",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    { puuid: "virmel-puuid", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

const FLAGS = [
  "betting_enabled",
  "dare_v2",
  "scoutql_relational_enabled",
] as const;

const deps = {
  prismaClient: db,
  // Every policy the funding path consults, which is more than the two this
  // file's subject suggests: a compiled plan's funding gate reads the
  // relational policy too, and omitting it fails the draft as feature_disabled
  // before the callout is ever reached.
  isPolicyEnabled: (name: string) =>
    Promise.resolve(FLAGS.map(String).includes(name)),
};

afterAll(() => {
  for (const flag of FLAGS) resetFlagOverrides(flag);
});

beforeEach(async () => {
  // The lifecycle reads the real flag store, not `deps.isPolicyEnabled`, so
  // the overrides are what let a draft be funded at all.
  for (const flag of FLAGS) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
  await db.confirmationIntent.deleteMany();
  await db.bucksDareV2Contribution.deleteMany();
  await db.bucksDareV2Target.deleteMany();
  await db.bucksDareV2Revision.deleteMany();
  await db.bucksDareV2.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
});

/**
 * A Dare past draft with no callout yet: the one state where
 * `ensureDareV2Callout` would POST rather than edit.
 *
 * Built through the real lifecycle rather than inserted, because a
 * hand-written row would prove the query and not the path.
 */
async function fundedDare(key: string): Promise<number> {
  const draft = await createDareDraftV2(
    {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      originalText: "I bet Virmel can't get 8 CS/m on Twisted Fate",
      plan: TWISTED_FATE_SAME_GAME_PLAN,
      targets: [TARGET_BINDING],
      deadlineSpec: { kind: "relative", days: 7 },
      openingStake: 20,
    },
    deps,
    T0,
  );
  if (draft.kind !== "created") throw new Error("Expected a Dare v2 draft.");
  const funding = await createDareV2ConfirmationIntent(
    {
      dareId: draft.dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { kind: "dare_fund" },
      idempotencyKey: key,
    },
    deps,
    T0,
  );
  if (funding.kind !== "intent_created") {
    throw new Error("Expected a funding intent.");
  }
  await consumeDareV2ConfirmationIntent(
    {
      intentId: funding.intentId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
    },
    deps,
    T0,
  );
  return draft.dareId;
}

describe("withholding a Dare v2 callout", () => {
  test("leaves no pending work behind when it withholds a callout", async () => {
    // Withholding the POST is only half the guarantee. The pending flag is
    // durable WORK, and the v1 post-match and pre-match pollers run the same
    // scan with no `mayPost` at all — so a flag left set is a callout posted
    // minutes later by a caller that never heard of delivery modes. The
    // suppression has to outlive the call that made it.
    const dareId = await fundedDare("fund-callout-withheld");
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "never-sent" }),
    );

    await expect(
      ensureDareV2Callout(dareId, {
        prismaClient: db,
        sendMessage,
        editMessage: vi.fn(() => Promise.resolve()),
        mayPost: () => false,
      }),
    ).resolves.toBe("withheld");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({ calloutRefreshPending: false, messageRef: null });

    // And the scan that knows nothing about delivery modes finds nothing to
    // do, which is the assertion that actually closes the path.
    const laterSend = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "later-scan-message" }),
    );
    await expect(
      refreshPendingDareV2Callouts({
        prismaClient: db,
        sendMessage: laterSend,
        editMessage: vi.fn(() => Promise.resolve()),
      }),
    ).resolves.toEqual([]);
    expect(laterSend).not.toHaveBeenCalled();
  });

  test("does not retire refresh work that arrived while it was withholding", async () => {
    // The compare-and-set. Something marking this Dare pending again between
    // the read and the write is a FRESH decision by whatever made it, and not
    // this run's to discard — so the version moves and the clear does nothing.
    const dareId = await fundedDare("fund-callout-withheld-concurrent");

    // Injected at the READ rather than at the gate: `mayPost` is synchronous,
    // so it cannot await a write, and the race this models is a write landing
    // between the row read and the retire.
    const racingRead = db.$extends({
      query: {
        bucksDareV2: {
          async findUnique({ args, query }) {
            const row = await query(args);
            await db.bucksDareV2.update({
              where: { id: dareId },
              data: {
                calloutRefreshPending: true,
                calloutRefreshVersion: { increment: 1 },
              },
            });
            return row;
          },
        },
      },
    });

    await expect(
      ensureDareV2Callout(dareId, {
        prismaClient: racingRead,
        sendMessage: vi.fn(() =>
          Promise.resolve({ channelId: CHANNEL, id: "never-sent" }),
        ),
        editMessage: vi.fn(() => Promise.resolve()),
        mayPost: () => false,
      }),
    ).resolves.toBe("withheld");

    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });
});
