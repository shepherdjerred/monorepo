import { describe, expect, test } from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { SEED_GRANT } from "#src/betting/constants.ts";
import { DARE_CONDITIONS_UNREADABLE } from "#src/betting/dares/dare-common.ts";
import { contributeToDare } from "#src/betting/dares/lifecycle/dare-contribute.ts";
import { acceptDare } from "#src/betting/dares/lifecycle/dare-accept.ts";
import {
  confirmDare,
  createProposedDare,
} from "#src/betting/dares/lifecycle/dare-create.ts";
import {
  CHALLENGER,
  CHANNEL_ID,
  CONTRIBUTOR,
  PUUID_A,
  SERVER_ID,
  TARGET_A,
  createDareTestHelpers,
  loadFixtureMatch,
  pastWindowGrace as sharedPastWindowGrace,
  registerDareLifecycleHooks,
  targetsInput,
  winConditions,
  winningMatch as sharedWinningMatch,
  type TargetSpec,
} from "#src/betting/dares/dare-integration-fixtures.ts";
import { settleDaresForMatch } from "#src/betting/dares/settlement/dare-settle.ts";
import { settleEndedDareWindows } from "#src/betting/dares/settlement/dare-sweep.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The two dare failure-safety corners that don't fit `dare.integration.test.ts`'s
 * line budget: an Int32-overflowing payout voiding cleanly, and refund paths
 * that must never depend on parsing the stored conditions blob. Split out
 * with its own isolated database rather than duplicating fixtures across
 * files — the shared constants, match builders, and db-bound helper factory
 * live in `dare-integration-fixtures.ts`.
 */

const { prisma: db } = createTestDatabase("bucks-dare-void");

const fixture = await loadFixtureMatch();

const GAME_START = fixture.info.gameStartTimestamp;
const GAME_END = fixture.info.gameEndTimestamp;
/** All creation/consent flows run at a fixed instant before the fixture
 * game begins, so the game falls inside every activated window. */
const T0 = new Date(GAME_START - 60_000);

const ONE_TARGET: TargetSpec[] = [
  { discordId: TARGET_A, alias: "alpha", puuid: PUUID_A },
];

const { deps, balanceOf, houseBalance, dareState, expectNoDrift, clearAll } =
  createDareTestHelpers(db, T0);

async function makeProposed(input?: {
  amount?: number;
  windowDays?: number;
}): Promise<number> {
  const created = await createProposedDare(
    {
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      challengerDiscordId: CHALLENGER,
      originalText: "I bet alpha can't win a game",
      translation: null,
      conditions: winConditions(),
      horizonKind: "window",
      windowDays: input?.windowDays ?? 7,
      amount: input?.amount ?? 5,
      targets: targetsInput(ONE_TARGET),
    },
    deps,
    T0,
  );
  if (created.kind !== "created") {
    throw new Error(`expected a created dare, got ${created.kind}`);
  }
  return created.dareId;
}

async function makeActive(input?: {
  amount?: number;
  windowDays?: number;
}): Promise<number> {
  const dareId = await makeProposed(input);
  const confirmed = await confirmDare(
    { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
    deps,
    T0,
  );
  if (confirmed.kind !== "confirmed") {
    throw new Error(`expected a confirmed dare, got ${confirmed.kind}`);
  }
  const accepted = await acceptDare(
    { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
    deps,
    T0,
  );
  if (accepted.kind !== "accepted") {
    throw new Error(`expected an accepted dare, got ${accepted.kind}`);
  }
  return dareId;
}

function winningMatch(specs: readonly TargetSpec[]): RawMatch {
  return sharedWinningMatch(fixture, specs);
}

/** A moment safely past a window-dare's `windowEndsAt` plus the ingestion
 * grace period, for exercising `settleEndedDareWindows`. */
function pastWindowGrace(windowDays = 1): Date {
  return sharedPastWindowGrace(T0, windowDays);
}

registerDareLifecycleHooks(db, clearAll);

describe("storage overflow", () => {
  test("a payout that cannot fit voids the dare and refunds contributors in full", async () => {
    const dareId = await makeActive({ amount: 5 });
    await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 5,
      },
      deps,
      T0,
    );
    const target = await db.bucksDareTarget.findFirstOrThrow({
      where: { dareId },
      select: { bucksAccountId: true },
    });
    if (target.bucksAccountId === null) {
      throw new Error("the accepted target should hold a wallet");
    }
    // Fill the payee's wallet to the Int32 ceiling through the only legal
    // mutator, so the ledger stays reconcilable and the credit below is the
    // single thing that overflows.
    await db.$transaction((tx) =>
      applyBucksDelta(tx, {
        bucksAccountId: target.bucksAccountId ?? 0,
        delta: BUCKS_INT32_MAX - SEED_GRANT,
        kind: "adjustment",
        context: {
          type: "adjustment",
          note: "fill to the Int32 ceiling",
          actorDiscordId: CHALLENGER,
        },
      }),
    );
    const houseBefore = await houseBalance();

    const summaries = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      new Date(GAME_END + 1000),
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual(["voided"]);
    expect(summaries[0]?.voidReason).toBe("storage_overflow");
    expect(await dareState(dareId)).toBe("voided");
    const stored = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { voidReason: true },
    });
    expect(stored.voidReason).toBe("storage_overflow");
    // Full refunds, no cut, and the rolled-back capture left no game row.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    expect(summaries[0]?.refunds.map((refund) => refund.fee)).toEqual([0, 0]);
    expect(await db.bucksDareGame.count({ where: { dareId } })).toBe(0);
    await expectNoDrift();
  });
});

async function dareContextSummaries(dareId: number): Promise<string[]> {
  const entries = await db.bucksLedgerEntry.findMany({
    where: { kind: { in: ["dare_refund", "dare_fee"] } },
    orderBy: { id: "asc" },
    select: { context: true },
  });
  return entries.flatMap((entry) => {
    const context = BucksLedgerContextSchema.parse(JSON.parse(entry.context));
    return context.type === "dare" && context.dareId === dareId
      ? [context.conditionSummary]
      : [];
  });
}

/**
 * Refunds are never blocked by a stored conditions blob the current schema
 * cannot read: the evaluator gate is checked before any parse, and the
 * condition summary degrades to a display placeholder.
 */
describe("unreadable stored conditions", () => {
  const CORRUPT = '{"version":1,"root":{"clauses":"not a list"}}';

  test("a window-end sweep still refunds, with the cut, on an unparseable blob", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    await db.bucksDare.update({
      where: { id: dareId },
      data: { conditions: CORRUPT },
    });
    const houseBefore = await houseBalance();
    const summaries = await settleEndedDareWindows(db, pastWindowGrace());
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "unachieved",
    ]);
    // Contributed 5: cut round(5 * 20%) = 1, refund 4 — the ordinary
    // unachieved arithmetic, unaffected by the unreadable blob.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT - 1);
    expect(await houseBalance()).toBe(houseBefore + 1);
    const summaries2 = await dareContextSummaries(dareId);
    expect(summaries2.length).toBeGreaterThan(0);
    expect(new Set(summaries2)).toEqual(new Set([DARE_CONDITIONS_UNREADABLE]));
    await expectNoDrift();
  });

  test("an unimplemented evaluator version voids in full without ever parsing", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    await db.bucksDare.update({
      where: { id: dareId },
      data: { conditions: CORRUPT, evaluatorVersion: "0" },
    });
    const houseBefore = await houseBalance();
    const summaries = await settleEndedDareWindows(db, pastWindowGrace());
    expect(summaries.map((summary) => summary.resolution)).toEqual(["voided"]);
    expect(summaries[0]?.voidReason).toBe("unknown_evaluator");
    // Voids are a FULL refund with no cut.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    expect(await dareContextSummaries(dareId)).toEqual([
      DARE_CONDITIONS_UNREADABLE,
    ]);
    await expectNoDrift();
  });
});
