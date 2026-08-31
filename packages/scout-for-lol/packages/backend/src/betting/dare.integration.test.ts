import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  RawMatchSchema,
  RawParticipantSchema,
  type DiscordAccountId,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  DARE_NEXT_GAME_TIMEOUT_MS,
  DARE_WINDOW_INGESTION_GRACE_MS,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import { acceptDare, declineDare } from "#src/betting/dare-accept.ts";
import { DARE_CONDITIONS_UNREADABLE } from "#src/betting/dare-common.ts";
import { contributeToDare } from "#src/betting/dare-contribute.ts";
import {
  abandonDare,
  confirmDare,
  createProposedDare,
  type CreateProposedDareInput,
} from "#src/betting/dare-create.ts";
import {
  DareConditionsSchema,
  type DareConditions,
} from "#src/betting/dare-criteria.ts";
import {
  dareMoneyFactsInTransaction,
  payDareTargetsInTransaction,
  refundDareContributionsInTransaction,
  type DareLedgerFacts,
} from "#src/betting/dare-ledger.ts";
import { settleDaresForMatch } from "#src/betting/dare-settle.ts";
import {
  abandonExpiredDareProposals,
  expireDareAcceptWindows,
  settleEndedDareWindows,
} from "#src/betting/dare-sweep.ts";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import { cancellationHouseCut } from "#src/betting/house-cut.ts";
import { applyBucksDelta, refundableBucksHeld } from "#src/betting/ledger.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  isPolicyEnabled,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-dare");

const deps = { prismaClient: db, isPolicyEnabled };

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNEL_ID = DiscordChannelIdSchema.parse("133762316414615777");
const CHALLENGER = bucksTestDiscordId(1);
const TARGET_A = bucksTestDiscordId(2);
const TARGET_B = bucksTestDiscordId(3);
const TARGET_C = bucksTestDiscordId(4);
const CONTRIBUTOR = bucksTestDiscordId(5);
const PUUID_A = bucksTestPuuid(30);
const PUUID_B = bucksTestPuuid(31);
const PUUID_C = bucksTestPuuid(32);

const GAME_START = fixture.info.gameStartTimestamp;
const GAME_END = fixture.info.gameEndTimestamp;
/** All creation/consent flows run at a fixed instant before the fixture
 * game begins, so the game falls inside every activated window. */
const T0 = new Date(GAME_START - 60_000);

function winConditions(requiredGames = 1): DareConditions {
  return DareConditionsSchema.parse({
    version: 1,
    root: {
      kind: "all",
      clauses: [
        {
          kind: "all",
          children: [
            {
              kind: "condition",
              requiredGames,
              predicate: {
                kind: "participant_boolean",
                field: "win",
                expected: true,
              },
              champion: null,
            },
          ],
        },
      ],
    },
  });
}

type TargetSpec = { discordId: DiscordAccountId; alias: string; puuid: string };

const ONE_TARGET: TargetSpec[] = [
  { discordId: TARGET_A, alias: "alpha", puuid: PUUID_A },
];
const THREE_TARGETS: TargetSpec[] = [
  { discordId: TARGET_A, alias: "alpha", puuid: PUUID_A },
  { discordId: TARGET_B, alias: "bravo", puuid: PUUID_B },
  { discordId: TARGET_C, alias: "charlie", puuid: PUUID_C },
];

function targetsInput(
  specs: readonly TargetSpec[],
): CreateProposedDareInput["targets"] {
  return specs.map((spec, index) => ({
    discordId: spec.discordId,
    playerId: PlayerIdSchema.parse(1000 + index),
    alias: spec.alias,
    accounts: [
      { puuid: spec.puuid, trackingStartedAt: new Date(0).toISOString() },
    ],
  }));
}

async function makeProposed(input?: {
  amount?: number;
  targets?: readonly TargetSpec[];
  horizonKind?: "next_game" | "window";
  windowDays?: number;
  conditions?: DareConditions;
}): Promise<number> {
  const created = await createProposedDare(
    {
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      challengerDiscordId: CHALLENGER,
      originalText: "I bet alpha can't win a game",
      translation: null,
      conditions: input?.conditions ?? winConditions(),
      horizonKind: input?.horizonKind ?? "window",
      ...(input?.horizonKind === "next_game"
        ? {}
        : { windowDays: input?.windowDays ?? 7 }),
      amount: input?.amount ?? 5,
      targets: targetsInput(input?.targets ?? ONE_TARGET),
    },
    deps,
    T0,
  );
  if (created.kind !== "created") {
    throw new Error(`expected a created dare, got ${created.kind}`);
  }
  return created.dareId;
}

async function makePendingAccept(
  input?: Parameters<typeof makeProposed>[0],
): Promise<number> {
  const dareId = await makeProposed(input);
  const confirmed = await confirmDare(
    { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
    deps,
    T0,
  );
  if (confirmed.kind !== "confirmed") {
    throw new Error(`expected a confirmed dare, got ${confirmed.kind}`);
  }
  return dareId;
}

async function makeActive(
  input?: Parameters<typeof makeProposed>[0] & { activateAt?: Date },
): Promise<number> {
  const dareId = await makePendingAccept(input);
  for (const spec of input?.targets ?? ONE_TARGET) {
    const accepted = await acceptDare(
      { dareId, serverId: SERVER_ID, targetDiscordId: spec.discordId },
      deps,
      input?.activateAt ?? T0,
    );
    if (accepted.kind !== "accepted") {
      throw new Error(`expected an accepted dare, got ${accepted.kind}`);
    }
  }
  return dareId;
}

/**
 * The fixture match with chosen participants re-identified as dare targets.
 * `assignments` maps a participant index to the frozen PUUID plus overrides.
 */
function matchFor(input: {
  assignments: Record<number, { puuid: string; win?: boolean }>;
  infoOverrides?: Record<string, unknown>;
}): RawMatch {
  const reparsed = RawMatchSchema.parse(structuredClone(fixture));
  const participants = reparsed.info.participants.map((participant, index) => {
    const assignment = input.assignments[index];
    if (assignment === undefined) return participant;
    return RawParticipantSchema.parse({
      ...participant,
      puuid: assignment.puuid,
      ...(assignment.win === undefined ? {} : { win: assignment.win }),
    });
  });
  return RawMatchSchema.parse({
    ...reparsed,
    info: {
      ...reparsed.info,
      ...input.infoOverrides,
      participants,
    },
  });
}

function winningMatch(specs: readonly TargetSpec[]): RawMatch {
  const assignments: Record<number, { puuid: string; win?: boolean }> = {};
  specs.forEach((spec, index) => {
    assignments[index] = { puuid: spec.puuid, win: true };
  });
  return matchFor({ assignments });
}

function losingMatch(specs: readonly TargetSpec[]): RawMatch {
  const assignments: Record<number, { puuid: string; win?: boolean }> = {};
  specs.forEach((spec, index) => {
    assignments[index] = { puuid: spec.puuid, win: false };
  });
  return matchFor({ assignments });
}

async function balanceOf(discordId: DiscordAccountId): Promise<number> {
  const account = await db.bucksAccount.findUniqueOrThrow({
    where: { serverId_discordId: { serverId: SERVER_ID, discordId } },
    select: { balance: true },
  });
  return account.balance;
}

async function houseBalance(): Promise<number> {
  const house = await db.bucksAccount.findFirstOrThrow({
    where: { serverId: SERVER_ID, isHouse: true },
    select: { balance: true },
  });
  return house.balance;
}

async function dareState(dareId: number): Promise<string> {
  const dare = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { dareState: true },
  });
  return dare.dareState;
}

async function expectNoDrift(): Promise<void> {
  expect(await reconcileBucksBalances(db)).toEqual([]);
}

/** Settle the match, assert the single expected resolution, and check the
 * dare row landed in the matching state. */
async function settleExpecting(
  dareId: number,
  match: RawMatch,
  at: Date,
  resolution: "achieved" | "unachieved" | "captured" | "voided",
): Promise<Awaited<ReturnType<typeof settleDaresForMatch>>> {
  const summaries = await settleDaresForMatch(match, db, at);
  expect(summaries.map((summary) => summary.resolution)).toEqual([resolution]);
  expect(await dareState(dareId)).toBe(
    resolution === "captured" ? "active" : resolution,
  );
  return summaries;
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksDareGame.deleteMany();
  await db.bucksDareContribution.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.player.deleteMany();
}

beforeEach(async () => {
  await clearAll();
  clearFlagOverrides("betting_enabled");
  clearFlagOverrides("bucks_dares_enabled");
  addFlagOverride("betting_enabled", true, { server: SERVER_ID });
  addFlagOverride("bucks_dares_enabled", true, { server: SERVER_ID });
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("bucks_dares_enabled");
  await clearAll();
  await db.$disconnect();
});

describe("dare proposal and confirmation", () => {
  test("a concurrent double-confirm debits the pledge exactly once", async () => {
    const dareId = await makeProposed({ amount: 5 });
    const results = await Promise.all([
      confirmDare(
        { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
        deps,
        T0,
      ),
      confirmDare(
        { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
        deps,
        T0,
      ),
    ]);
    const confirmed = results.filter((result) => result.kind === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT - 5);
    expect(await db.bucksDareContribution.count({ where: { dareId } })).toBe(1);
    expect(await dareState(dareId)).toBe("pending_accept");
    await expectNoDrift();
  });

  test("an unaffordable pledge rolls back and leaves the dare proposed", async () => {
    const dareId = await makeProposed({ amount: SEED_GRANT + 1 });
    const result = await confirmDare(
      { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
      deps,
      T0,
    );
    expect(result.kind).toBe("insufficient");
    expect(await dareState(dareId)).toBe("proposed");
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await db.bucksDareContribution.count({ where: { dareId } })).toBe(0);
    await expectNoDrift();
  });

  test("the challenger can abandon an unconfirmed proposal", async () => {
    const dareId = await makeProposed();
    const result = await abandonDare(
      { dareId, serverId: SERVER_ID, challengerDiscordId: CHALLENGER },
      deps,
    );
    expect(result.kind).toBe("abandoned");
    expect(await dareState(dareId)).toBe("abandoned");
  });

  test("the proposal-TTL sweep abandons what nobody confirmed", async () => {
    const dareId = await makeProposed();
    const early = await abandonExpiredDareProposals(db, T0);
    expect(early).toEqual([]);
    const summaries = await abandonExpiredDareProposals(
      db,
      new Date(T0.getTime() + 11 * 60 * 1000),
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "abandoned",
    ]);
    expect(await dareState(dareId)).toBe("abandoned");
  });
});

describe("contributions", () => {
  test("contributions append; targets are barred from the pot", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    const first = await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 3,
      },
      deps,
      T0,
    );
    expect(first.kind).toBe("contributed");
    const second = await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 1,
      },
      deps,
      T0,
    );
    expect(second.kind === "contributed" && second.potTotal === 9).toBe(true);
    const barred = await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: TARGET_A,
        amount: 1,
      },
      deps,
      T0,
    );
    expect(barred.kind).toBe("target_cannot_contribute");
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT - 4);
    await expectNoDrift();
  });

  test("open contributions count against refundable credit headroom", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    const account = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: CHALLENGER },
      },
      select: { id: true },
    });
    const held = await db.$transaction((tx) =>
      refundableBucksHeld(tx, account.id),
    );
    expect(held).toBe(5n);
    // A resolved dare releases the headroom.
    await declineDare(
      { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
      deps,
      T0,
    );
    const releasedHeld = await db.$transaction((tx) =>
      refundableBucksHeld(tx, account.id),
    );
    expect(releasedHeld).toBe(0n);
  });

  test("a contribution racing settlement either lands in the pot or is too late", async () => {
    const dareId = await makeActive({ horizonKind: "next_game", amount: 5 });
    const [contribution, summaries] = await Promise.all([
      contributeToDare(
        {
          dareId,
          serverId: SERVER_ID,
          contributorDiscordId: CONTRIBUTOR,
          amount: 3,
        },
        deps,
        new Date(GAME_END + 1000),
      ),
      settleDaresForMatch(
        winningMatch(ONE_TARGET),
        db,
        new Date(GAME_END + 1000),
      ),
    ]);
    expect(await dareState(dareId)).toBe("achieved");
    const settledDare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { potTotal: true },
    });
    const potTotal = settledDare.potTotal;
    const contributed = await db.bucksDareContribution.aggregate({
      where: { dareId },
      _sum: { amount: true },
    });
    // Exactly one interleaving wins: either the contribution serialized in
    // before settlement and the settled pot includes it, or it was told
    // too_late and the pot stayed at the pledge.
    if (contribution.kind === "contributed") {
      expect(potTotal).toBe(8);
    } else {
      expect(contribution.kind).toBe("too_late");
      expect(potTotal).toBe(5);
    }
    expect(contributed._sum.amount).toBe(potTotal);
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "achieved",
    ]);
    await expectNoDrift();
  });
});

describe("consent", () => {
  test("a concurrent double-accept stamps once", async () => {
    // Two targets so the racing double-accept cannot also be the activation:
    // the losing click must see "already accepted", not a resolved dare.
    const dareId = await makePendingAccept({
      targets: THREE_TARGETS.slice(0, 2),
    });
    const results = await Promise.all([
      acceptDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
        deps,
        T0,
      ),
      acceptDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
        deps,
        T0,
      ),
    ]);
    expect(results.filter((result) => result.kind === "accepted")).toHaveLength(
      1,
    );
    expect(
      results.filter((result) => result.kind === "already_accepted"),
    ).toHaveLength(1);
    expect(await dareState(dareId)).toBe("pending_accept");
    const stamped = await db.bucksDareTarget.count({
      where: { dareId, acceptedAt: { not: null } },
    });
    expect(stamped).toBe(1);
  });

  test("concurrent last accepts activate exactly once", async () => {
    const targets = THREE_TARGETS.slice(0, 2);
    const dareId = await makePendingAccept({ targets });
    const results = await Promise.all(
      targets.map((spec) =>
        acceptDare(
          { dareId, serverId: SERVER_ID, targetDiscordId: spec.discordId },
          deps,
          T0,
        ),
      ),
    );
    const accepted = results.filter((result) => result.kind === "accepted");
    expect(accepted).toHaveLength(2);
    expect(accepted.filter((result) => result.activated)).toHaveLength(1);
    expect(await dareState(dareId)).toBe("active");
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { activatedAt: true, windowEndsAt: true },
    });
    expect(dare.activatedAt).not.toBeNull();
    expect(dare.windowEndsAt).not.toBeNull();
  });

  test("an accept racing a decline resolves to declined with full refunds", async () => {
    const targets = THREE_TARGETS.slice(0, 2);
    const dareId = await makePendingAccept({ targets, amount: 5 });
    const [acceptResult, declineResult] = await Promise.all([
      acceptDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
        deps,
        T0,
      ),
      declineDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_B },
        deps,
        T0,
      ),
    ]);
    // B never accepts, so the dare can never activate: whichever order the
    // race commits in, the decline stands.
    expect(await dareState(dareId)).toBe("declined");
    expect(declineResult.kind).toBe("declined");
    expect(["accepted", "already_resolved"]).toContain(acceptResult.kind);
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    await expectNoDrift();
  });

  test("a decline refunds every contributor in full, no cut", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 3,
      },
      deps,
      T0,
    );
    const houseBefore = await houseBalance();
    const result = await declineDare(
      { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
      deps,
      T0,
    );
    expect(result.kind).toBe("declined");
    expect(await dareState(dareId)).toBe("declined");
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    await expectNoDrift();
  });

  test("an accepted target cannot retract", async () => {
    const targets = THREE_TARGETS.slice(0, 2);
    const dareId = await makePendingAccept({ targets });
    await acceptDare(
      { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
      deps,
      T0,
    );
    const retraction = await declineDare(
      { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
      deps,
      T0,
    );
    expect(retraction.kind).toBe("already_accepted");
    expect(await dareState(dareId)).toBe("pending_accept");
  });

  test("the accept-window sweep expires and fully refunds", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    const afterDeadline = new Date(T0.getTime() + 25 * 60 * 60 * 1000);
    const summaries = await expireDareAcceptWindows(db, afterDeadline);
    expect(summaries.map((summary) => summary.resolution)).toEqual(["expired"]);
    expect(await dareState(dareId)).toBe("expired");
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    await expectNoDrift();
  });
});

describe("capture and settlement", () => {
  const settleTime = new Date(GAME_END + 1000);

  test("an achieved dare splits the pot with the winner fee, N=1", async () => {
    const dareId = await makeActive({ amount: 5 });
    const houseBefore = await houseBalance();
    await settleExpecting(
      dareId,
      winningMatch(ONE_TARGET),
      settleTime,
      "achieved",
    );
    // share 5, fee floor(5 * 20%) = 1, net 4, remainder 0.
    expect(await balanceOf(TARGET_A)).toBe(SEED_GRANT + 4);
    expect(await houseBalance()).toBe(houseBefore + 1);
    const target = await db.bucksDareTarget.findFirstOrThrow({
      where: { dareId },
      select: { payout: true, fee: true },
    });
    expect(target).toEqual({ payout: 4, fee: 1 });
    await expectNoDrift();
  });

  test("a three-target split sends the indivisible remainder to the house", async () => {
    const dareId = await makeActive({ targets: THREE_TARGETS, amount: 5 });
    await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 3,
      },
      deps,
      T0,
    );
    const houseBefore = await houseBalance();
    const summaries = await settleDaresForMatch(
      winningMatch(THREE_TARGETS),
      db,
      settleTime,
    );
    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    // pot 8 over 3 targets: share 2, fee floor(0.4) = 0, remainder 2.
    expect(summary?.payouts.map((payout) => payout.net)).toEqual([2, 2, 2]);
    expect(await balanceOf(TARGET_A)).toBe(SEED_GRANT + 2);
    expect(await balanceOf(TARGET_B)).toBe(SEED_GRANT + 2);
    expect(await balanceOf(TARGET_C)).toBe(SEED_GRANT + 2);
    expect(await houseBalance()).toBe(houseBefore + 2);
    await expectNoDrift();
  });

  test("capture is idempotent per (dare, match)", async () => {
    const dareId = await makeActive({ conditions: winConditions(2) });
    const first = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      settleTime,
    );
    expect(first.map((summary) => summary.resolution)).toEqual(["captured"]);
    const replay = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      settleTime,
    );
    expect(replay).toEqual([]);
    expect(await db.bucksDareGame.count({ where: { dareId } })).toBe(1);
    expect(await dareState(dareId)).toBe("active");
    await expectNoDrift();
  });

  test("a settled dare cannot be settled again", async () => {
    const dareId = await makeActive({ amount: 5 });
    await settleDaresForMatch(winningMatch(ONE_TARGET), db, settleTime);
    const balanceAfter = await balanceOf(TARGET_A);
    const again = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      settleTime,
    );
    expect(again).toEqual([]);
    expect(await balanceOf(TARGET_A)).toBe(balanceAfter);
    expect(await dareState(dareId)).toBe("achieved");
    await expectNoDrift();
  });

  test("remakes, wrong queues, pre-activation and post-window games never capture", async () => {
    const dareId = await makeActive({ conditions: winConditions(2) });

    const remake = RawMatchSchema.parse({
      ...winningMatch(ONE_TARGET),
      info: { ...winningMatch(ONE_TARGET).info, gameDuration: 200 },
    });
    expect(await settleDaresForMatch(remake, db, settleTime)).toEqual([]);

    const aram = matchFor({
      assignments: { 0: { puuid: PUUID_A, win: true } },
      infoOverrides: { queueId: 450 },
    });
    expect(await settleDaresForMatch(aram, db, settleTime)).toEqual([]);

    // Pre-activation: the game started before this dare existed.
    await db.bucksDare.update({
      where: { id: dareId },
      data: { activatedAt: new Date(GAME_START + 1) },
    });
    expect(
      await settleDaresForMatch(winningMatch(ONE_TARGET), db, settleTime),
    ).toEqual([]);

    // Post-window: the game ended after the deadline.
    await db.bucksDare.update({
      where: { id: dareId },
      data: {
        activatedAt: T0,
        windowEndsAt: new Date(GAME_END - 1),
      },
    });
    expect(
      await settleDaresForMatch(winningMatch(ONE_TARGET), db, settleTime),
    ).toEqual([]);

    expect(await db.bucksDareGame.count({ where: { dareId } })).toBe(0);
  });

  test("a game ingested after the window ends still captures when it ENDED inside it", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    // Ingest arrives well after windowEndsAt but the game ended inside it.
    const lateIngest = new Date(
      T0.getTime() + 24 * 60 * 60 * 1000 + 10 * 60 * 1000,
    );
    await settleExpecting(
      dareId,
      winningMatch(ONE_TARGET),
      lateIngest,
      "achieved",
    );
    await expectNoDrift();
  });

  test("a stored evaluator version this code does not implement voids with full refunds", async () => {
    const dareId = await makeActive({ amount: 5 });
    await db.bucksDare.update({
      where: { id: dareId },
      data: { evaluatorVersion: "0" },
    });
    const houseBefore = await houseBalance();
    const summaries = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      settleTime,
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual(["voided"]);
    expect(summaries[0]?.voidReason).toBe("unknown_evaluator");
    expect(await dareState(dareId)).toBe("voided");
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    await expectNoDrift();
  });
});

describe("next_game dares", () => {
  const settleTime = new Date(GAME_END + 1000);

  test("the bound game settles achieved when the tree holds", async () => {
    const dareId = await makeActive({ horizonKind: "next_game", amount: 5 });
    await settleExpecting(
      dareId,
      winningMatch(ONE_TARGET),
      settleTime,
      "achieved",
    );
    await expectNoDrift();
  });

  test("the bound game settles unachieved immediately when it fails", async () => {
    const dareId = await makeActive({ horizonKind: "next_game", amount: 5 });
    const houseBefore = await houseBalance();
    await settleExpecting(
      dareId,
      losingMatch(ONE_TARGET),
      settleTime,
      "unachieved",
    );
    // Refund 5 minus the nearest-BB cancellation cut of 1.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT - 5 + 4);
    expect(await houseBalance()).toBe(houseBefore + 1);
    await expectNoDrift();
  });

  test("a next_game dare nobody plays times out unachieved via the sweep", async () => {
    const dareId = await makeActive({ horizonKind: "next_game", amount: 5 });
    const beforeTimeout = new Date(
      T0.getTime() + DARE_NEXT_GAME_TIMEOUT_MS - 1000,
    );
    expect(await settleEndedDareWindows(db, beforeTimeout)).toEqual([]);
    const afterTimeout = new Date(
      T0.getTime() +
        DARE_NEXT_GAME_TIMEOUT_MS +
        DARE_WINDOW_INGESTION_GRACE_MS +
        1000,
    );
    const summaries = await settleEndedDareWindows(db, afterTimeout);
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "unachieved",
    ]);
    expect(await dareState(dareId)).toBe("unachieved");
    await expectNoDrift();
  });
});

describe("window sweep", () => {
  test("an ended window settles unachieved with the cancellation cut, honouring the grace", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    await contributeToDare(
      {
        dareId,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 3,
      },
      deps,
      T0,
    );
    const windowEnd = T0.getTime() + 24 * 60 * 60 * 1000;
    // Inside the ingestion grace nothing sweeps.
    expect(
      await settleEndedDareWindows(db, new Date(windowEnd + 1000)),
    ).toEqual([]);
    const houseBefore = await houseBalance();
    const summaries = await settleEndedDareWindows(
      db,
      new Date(windowEnd + DARE_WINDOW_INGESTION_GRACE_MS + 1000),
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "unachieved",
    ]);
    // Challenger contributed 5: cut round(1.0) = 1, refund 4.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT - 1);
    // Contributor put in 3: cut round(0.6) = 1, refund 2.
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT - 1);
    expect(await houseBalance()).toBe(houseBefore + 2);
    await expectNoDrift();
  });

  test("a 1 BB pot rounds to a zero cut and refunds whole", async () => {
    expect(cancellationHouseCut(1)).toBe(0);
    const dareId = await makeActive({ amount: 1, windowDays: 1 });
    const houseBefore = await houseBalance();
    const summaries = await settleEndedDareWindows(
      db,
      new Date(
        T0.getTime() +
          24 * 60 * 60 * 1000 +
          DARE_WINDOW_INGESTION_GRACE_MS +
          1000,
      ),
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "unachieved",
    ]);
    expect(await dareState(dareId)).toBe("unachieved");
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    await expectNoDrift();
  });
});

describe("feature flag revocation", () => {
  test("the flag stops taking Bucks but never blocks refunds or settlement", async () => {
    const activeDare = await makeActive({ amount: 5 });
    const pendingDare = await makePendingAccept({
      targets: [{ discordId: TARGET_B, alias: "bravo", puuid: PUUID_B }],
      amount: 4,
    });

    clearFlagOverrides("bucks_dares_enabled");
    addFlagOverride("bucks_dares_enabled", false, { server: SERVER_ID });

    // Taking money is blocked...
    const created = await createProposedDare(
      {
        serverId: SERVER_ID,
        channelId: CHANNEL_ID,
        challengerDiscordId: CHALLENGER,
        originalText: "no more dares",
        translation: null,
        conditions: winConditions(),
        horizonKind: "window",
        windowDays: 7,
        amount: 1,
        targets: targetsInput(ONE_TARGET),
      },
      deps,
      T0,
    );
    expect(created.kind).toBe("feature_disabled");
    const contribution = await contributeToDare(
      {
        dareId: activeDare,
        serverId: SERVER_ID,
        contributorDiscordId: CONTRIBUTOR,
        amount: 1,
      },
      deps,
      T0,
    );
    expect(contribution.kind).toBe("feature_disabled");
    const acceptance = await acceptDare(
      { dareId: pendingDare, serverId: SERVER_ID, targetDiscordId: TARGET_B },
      deps,
      T0,
    );
    expect(acceptance.kind).toBe("feature_disabled");

    // ...while chicken-out and settlement still run.
    const declined = await declineDare(
      { dareId: pendingDare, serverId: SERVER_ID, targetDiscordId: TARGET_B },
      deps,
      T0,
    );
    expect(declined.kind).toBe("declined");
    const summaries = await settleDaresForMatch(
      winningMatch(ONE_TARGET),
      db,
      new Date(GAME_END + 1000),
    );
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "achieved",
    ]);
    // Staked 5 on the achieved dare (paid to the target), refunded 4 whole
    // from the declined one.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT - 5);
    await expectNoDrift();
  });
});

/** A frozen copy of the row's money facts, captured before the extra
 * contribution commits — i.e. what a pre-transaction read would hold. */
async function staleFactsFor(dareId: number): Promise<DareLedgerFacts> {
  const row = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    include: { targets: { orderBy: { id: "asc" } } },
  });
  return {
    dareId,
    serverId: row.serverId,
    potTotal: row.potTotal,
    targetAliases: row.targets.map((target) => target.alias),
    conditionSummary: "alpha wins at least 1 game",
  };
}

async function payeesOf(dareId: number) {
  const targets = await db.bucksDareTarget.findMany({
    where: { dareId },
    orderBy: { id: "asc" },
  });
  return targets.map((target) => {
    if (target.bucksAccountId === null) {
      throw new Error(`target ${target.id.toString()} has no wallet`);
    }
    return {
      id: target.id,
      discordId: target.discordId,
      alias: target.alias,
      bucksAccountId: target.bucksAccountId,
    };
  });
}

async function contributeFive(dareId: number): Promise<void> {
  const contribution = await contributeToDare(
    {
      dareId,
      serverId: SERVER_ID,
      contributorDiscordId: CONTRIBUTOR,
      amount: 5,
    },
    deps,
    T0,
  );
  expect(contribution.kind).toBe("contributed");
}

/**
 * The dare row read before a transaction opens may drive eligibility and
 * discovery, never money: a contribution can commit between that read and
 * the guarded claim. These tests simulate exactly that window with a stale
 * row copy, and assert both halves of the invariant — the stale copy is
 * caught by a conservation assert that THROWS, and the post-claim re-read
 * settles the enlarged pot exactly.
 */
describe("intra-transaction money facts", () => {
  test("an achieved payout pays the enlarged pot, and the stale copy throws", async () => {
    const dareId = await makeActive({ amount: 5 });
    const stale = await staleFactsFor(dareId);
    expect(stale.potTotal).toBe(5);
    await contributeFive(dareId);
    const targets = await payeesOf(dareId);

    await expect(
      db.$transaction((tx) =>
        payDareTargetsInTransaction(tx, { facts: stale, targets }),
      ),
    ).rejects.toThrow(/sum to 10 but potTotal is 5/);

    const houseBefore = await houseBalance();
    const paid = await db.$transaction(async (tx) => {
      const facts = await dareMoneyFactsInTransaction(tx, stale);
      expect(facts.potTotal).toBe(10);
      return await payDareTargetsInTransaction(tx, { facts, targets });
    });
    // pot 10 to one target: share 10, fee floor(10 * 20%) = 2, net 8.
    expect(paid.payouts.map((payout) => payout.net)).toEqual([8]);
    expect(paid.remainder).toBe(0);
    const distributed =
      paid.payouts.reduce((total, p) => total + p.net + p.fee, 0) +
      paid.remainder;
    expect(distributed).toBe(10);
    expect(await balanceOf(TARGET_A)).toBe(SEED_GRANT + 8);
    expect(await houseBalance()).toBe(houseBefore + 2);
    await expectNoDrift();
  });

  test("a decline refunds the enlarged pot in full, and the stale copy throws", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    const stale = await staleFactsFor(dareId);
    await contributeFive(dareId);

    await expect(
      db.$transaction((tx) =>
        refundDareContributionsInTransaction(tx, {
          facts: stale,
          resolution: "declined",
          withCut: false,
        }),
      ),
    ).rejects.toThrow(/sum to 10 but potTotal is 5/);

    const houseBefore = await houseBalance();
    const refunds = await db.$transaction(async (tx) => {
      const facts = await dareMoneyFactsInTransaction(tx, stale);
      expect(facts.potTotal).toBe(10);
      return await refundDareContributionsInTransaction(tx, {
        facts,
        resolution: "declined",
        withCut: false,
      });
    });
    const returned = refunds.reduce(
      (total, refund) => total + refund.refunded + refund.fee,
      0,
    );
    expect(returned).toBe(10);
    expect(refunds.map((refund) => refund.fee)).toEqual([0, 0]);
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    await expectNoDrift();
  });

  test("a window-end refund cuts the enlarged pot, and the stale copy throws", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    const stale = await staleFactsFor(dareId);
    await contributeFive(dareId);

    await expect(
      db.$transaction((tx) =>
        refundDareContributionsInTransaction(tx, {
          facts: stale,
          resolution: "unachieved",
          withCut: true,
        }),
      ),
    ).rejects.toThrow(/sum to 10 but potTotal is 5/);

    const houseBefore = await houseBalance();
    const refunds = await db.$transaction(async (tx) => {
      const facts = await dareMoneyFactsInTransaction(tx, stale);
      return await refundDareContributionsInTransaction(tx, {
        facts,
        resolution: "unachieved",
        withCut: true,
      });
    });
    // Two contributors of 5 each: cut round(5 * 20%) = 1, refund 4.
    expect(refunds.map((refund) => refund.refunded)).toEqual([4, 4]);
    const returned = refunds.reduce(
      (total, refund) => total + refund.refunded + refund.fee,
      0,
    );
    expect(returned).toBe(10);
    expect(await houseBalance()).toBe(houseBefore + 2);
    await expectNoDrift();
  });
});

/**
 * The same window, exercised end to end: whichever interleaving commits, the
 * settled pot and the contribution rows agree and the money conserves.
 */
describe("resolutions racing a contribution", () => {
  test("a decline racing a contribution conserves whichever pot committed", async () => {
    const dareId = await makePendingAccept({ amount: 5 });
    // Seed the contributor's wallet first: a first-time seed grant moves BB
    // out of the house and would be mistaken for a cut below.
    await ensureBucksAccount(
      { serverId: SERVER_ID, discordId: CONTRIBUTOR },
      db,
    );
    const houseBefore = await houseBalance();
    const [contribution, declined] = await Promise.all([
      contributeToDare(
        {
          dareId,
          serverId: SERVER_ID,
          contributorDiscordId: CONTRIBUTOR,
          amount: 3,
        },
        deps,
        T0,
      ),
      declineDare(
        { dareId, serverId: SERVER_ID, targetDiscordId: TARGET_A },
        deps,
        T0,
      ),
    ]);
    expect(declined.kind).toBe("declined");
    expect(await dareState(dareId)).toBe("declined");
    const landed = contribution.kind === "contributed";
    // Declines are a full refund with no cut, whichever pot committed.
    expect(await balanceOf(CHALLENGER)).toBe(SEED_GRANT);
    expect(await balanceOf(CONTRIBUTOR)).toBe(SEED_GRANT);
    expect(await houseBalance()).toBe(houseBefore);
    if (declined.kind === "declined") {
      expect(declined.potTotal).toBe(landed ? 8 : 5);
    }
    await expectNoDrift();
  });

  test("a window sweep racing a contribution conserves whichever pot committed", async () => {
    const dareId = await makeActive({ amount: 5, windowDays: 1 });
    await ensureBucksAccount(
      { serverId: SERVER_ID, discordId: CONTRIBUTOR },
      db,
    );
    const sweepAt = new Date(
      T0.getTime() +
        24 * 60 * 60 * 1000 +
        DARE_WINDOW_INGESTION_GRACE_MS +
        1000,
    );
    const [contribution, summaries] = await Promise.all([
      contributeToDare(
        {
          dareId,
          serverId: SERVER_ID,
          contributorDiscordId: CONTRIBUTOR,
          amount: 5,
        },
        deps,
        sweepAt,
      ),
      settleEndedDareWindows(db, sweepAt),
    ]);
    expect(summaries.map((summary) => summary.resolution)).toEqual([
      "unachieved",
    ]);
    const settled = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      select: { potTotal: true },
    });
    const contributed = await db.bucksDareContribution.aggregate({
      where: { dareId },
      _sum: { amount: true },
    });
    expect(contributed._sum.amount).toBe(settled.potTotal);
    expect(settled.potTotal).toBe(contribution.kind === "contributed" ? 10 : 5);
    const summary = summaries[0];
    const returned =
      summary?.refunds.reduce(
        (total, refund) => total + refund.refunded + refund.fee,
        0,
      ) ?? 0;
    expect(returned).toBe(settled.potTotal);
    await expectNoDrift();
  });
});

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
    const summaries = await settleEndedDareWindows(
      db,
      new Date(
        T0.getTime() +
          24 * 60 * 60 * 1000 +
          DARE_WINDOW_INGESTION_GRACE_MS +
          1000,
      ),
    );
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
    const summaries = await settleEndedDareWindows(
      db,
      new Date(
        T0.getTime() +
          24 * 60 * 60 * 1000 +
          DARE_WINDOW_INGESTION_GRACE_MS +
          1000,
      ),
    );
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
