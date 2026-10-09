import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksDeltaSchema,
  type DareTargetBinding,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  DARE_WINDOW_INGESTION_GRACE_MS,
  HOUSE_ACCOUNT_DISCORD_ID,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { reconcileBucksBalances } from "#src/betting/settlement/reconcile.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import {
  loadRiftFixture,
  targetMatchAt,
  type StubbedLake,
} from "#src/betting/dares/dare-test-fixtures.ts";
import {
  clearDareTables,
  createDareLifecycleHarness,
  freezeDareAsMonotone,
} from "#src/betting/dares/dare-integration.test-fixtures.ts";

/**
 * The Dare lifecycle end to end: drafting, funding, acceptance, contribution,
 * evidence capture, settlement, refunds, and the public callout.
 *
 * The SQL compiler is real, so drafts carry a genuine frozen AST and query
 * hash. Only lake execution is stubbed: each test says what the contract's
 * evidence is, and everything from the evidence down — finality, the money,
 * the callout — runs for real.
 */

const lake = vi.hoisted((): StubbedLake => ({
  achieved: false,
  sourceMatchIds: [],
}));

vi.mock("#src/betting/dares/sql/dare-sql.ts", async () => {
  const { stubbedDareSqlModule } =
    await import("#src/betting/dares/dare-test-fixtures.ts");
  return await stubbedDareSqlModule(lake);
});

const { reviseDareDraft } =
  await import("#src/betting/dares/lifecycle/dare-draft.ts");
const { DarePartialSettlementError } =
  await import("#src/betting/dares/settlement/dare-settle-types.ts");
const { inspectVisibleDare, listVisibleDares } =
  await import("#src/betting/dares/presentation/dare-view.ts");
const { consumeDareConfirmationIntent } =
  await import("#src/betting/dares/lifecycle/dare-intent-consume.ts");
const { createDareConfirmationIntent } =
  await import("#src/betting/dares/lifecycle/dare-intent.ts");
const { parseRelationalDareContract } =
  await import("#src/betting/dares/dare-common.ts");
const { settleDaresForMatch } =
  await import("#src/betting/dares/settlement/dare-settle.ts");
const { settleEndedDareWindows } =
  await import("#src/betting/dares/settlement/dare-sweep.ts");

const { prisma: db } = createTestDatabase("bucks-dare");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const SECOND_TARGET = testAccountId("925");
const CONTRIBUTOR = testAccountId("926");
const T0 = new Date("2026-09-01T12:00:00.000Z");
const SHARED_WIN_SQL =
  "SELECT COUNT(*) >= 1 AS achieved FROM T1 a JOIN T2 b USING (match_id) WHERE a.win";
let matchFixture: RawMatch;

const TARGET_BINDING: DareTargetBinding = {
  key: "T1",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    {
      puuid: LeaguePuuidSchema.parse(
        "virmel-puuid000000000000000000000000000000000000000000000000000000000000000000",
      ),
      trackingStartedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const SECOND_TARGET_BINDING: DareTargetBinding = {
  key: "T2",
  discordId: SECOND_TARGET,
  playerId: 2,
  alias: "Bryan",
  accounts: [
    {
      puuid: LeaguePuuidSchema.parse(
        "bryan-puuid0000000000000000000000000000000000000000000000000000000000000000000",
      ),
      trackingStartedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const {
  deps,
  definition,
  makeDraft,
  contribute,
  intent,
  consume,
  fund,
  activate,
} = createDareLifecycleHarness({
  db,
  serverId: SERVER,
  channelId: CHANNEL,
  challenger: CHALLENGER,
  target: TARGET,
  targetBinding: TARGET_BINDING,
  now: T0,
});

async function clearAll(): Promise<void> {
  await clearDareTables(db);
}

async function makeMonotone(dareId: number): Promise<void> {
  await freezeDareAsMonotone(db, dareId);
}

function matchAt(matchId: RiotMatchId, minutesAfterActivation = 60): RawMatch {
  return targetMatchAt(
    matchFixture,
    matchId,
    new Date(T0.getTime() + minutesAfterActivation * 60 * 1000),
  );
}

beforeEach(async () => {
  await clearAll();
  lake.achieved = false;
  lake.sourceMatchIds = [];
  for (const flag of ["betting_enabled", "bucks_dares_enabled"] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

beforeAll(async () => {
  matchFixture = await loadRiftFixture();
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("bucks_dares_enabled");
  await clearAll();
  await db.$disconnect();
});

async function fillTargetWallet(dareId: number): Promise<void> {
  const target = await db.bucksDareTarget.findFirstOrThrow({
    where: { dareId },
    select: { bucksAccountId: true },
  });
  if (target.bucksAccountId === null) {
    throw new Error("Expected the accepted target to have a Bucks wallet.");
  }
  const account = await db.bucksAccount.findUniqueOrThrow({
    where: { id: target.bucksAccountId },
  });
  await db.$transaction((tx) =>
    applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: BucksDeltaSchema.parse(BUCKS_INT32_MAX - account.balance),
      kind: "adjustment",
      context: {
        type: "adjustment",
        note: "fill Dare target wallet to the Int32 ceiling",
        actorDiscordId: CHALLENGER,
      },
    }),
  );
}

async function expectStorageOverflowVoid(
  dareId: number,
  evidenceCount: number,
): Promise<void> {
  const dare = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
  });
  expect(dare.dareState).toBe("voided");
  expect(dare.voidReason).toBe("storage_overflow");
  expect(await db.bucksDareEvidence.count({ where: { dareId } })).toBe(
    evidenceCount,
  );
  const challenger = await db.bucksAccount.findUniqueOrThrow({
    where: {
      serverId_discordId: { serverId: SERVER, discordId: CHALLENGER },
    },
  });
  expect(challenger.balance).toBe(SEED_GRANT);
  await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
}

async function expectChallengerBalance(balance: number): Promise<void> {
  const wallet = await db.bucksAccount.findUniqueOrThrow({
    where: {
      serverId_discordId: { serverId: SERVER, discordId: CHALLENGER },
    },
  });
  expect(wallet.balance).toBe(balance);
  await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
}

async function houseAccountId(): Promise<number> {
  const house = await db.bucksAccount.findUniqueOrThrow({
    where: {
      serverId_discordId: {
        serverId: SERVER,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
      },
    },
    select: { id: true },
  });
  return house.id;
}

async function expectSingleLedgerDelta(
  bucksAccountId: number,
  kind: string,
  delta: number,
): Promise<void> {
  expect(
    await db.bucksLedgerEntry.findMany({
      where: { bucksAccountId, kind },
      select: { delta: true },
    }),
  ).toEqual([{ delta }]);
}

async function activeDareDeadline(dareId: number): Promise<Date> {
  const active = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { deadlineAt: true },
  });
  if (active.deadlineAt === null) {
    throw new Error("Active Dare has no deadline.");
  }
  return active.deadlineAt;
}

function clientFailingSecondTransaction(message: string) {
  let transactionCalls = 0;
  return new Proxy(db, {
    get(target, property) {
      if (property === "$transaction") {
        return (
          ...transactionArguments: Parameters<typeof db.$transaction>
        ) => {
          transactionCalls += 1;
          return transactionCalls === 1
            ? Reflect.apply(target.$transaction, target, transactionArguments)
            : Promise.reject(new Error(message));
        };
      }
      return Reflect.get(target, property, target);
    },
  });
}

describe("Dare draft and lifecycle", () => {
  test("keeps drafts private while exposing their frozen targets to the owner", async () => {
    const dareId = await makeDraft();
    const mine = await listVisibleDares(
      {
        serverId: SERVER,
        viewerDiscordId: CHALLENGER,
        scope: "mine",
      },
      db,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.targetAliases).toEqual(["Virmel"]);
    await expect(
      listVisibleDares(
        {
          serverId: SERVER,
          viewerDiscordId: CHALLENGER,
          scope: "mine",
          search: "Virmel",
        },
        db,
      ),
    ).resolves.toHaveLength(1);
    const inspected = await inspectVisibleDare(
      {
        dareId,
        serverId: SERVER,
        viewerDiscordId: CHALLENGER,
      },
      db,
    );
    expect(inspected?.plan.compilerVersion).toBe("dare-scoutql-3");
    expect(inspected?.targets.map((target) => target.alias)).toEqual([
      "Virmel",
    ]);
    await expect(
      inspectVisibleDare(
        { dareId, serverId: SERVER, viewerDiscordId: TARGET },
        db,
      ),
    ).resolves.toBeNull();
    await expect(
      listVisibleDares(
        { serverId: SERVER, viewerDiscordId: TARGET, scope: "guild" },
        db,
      ),
    ).resolves.toEqual([]);
  });

  test("searches only the active revision's visible text and aliases", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraft(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: definition({
          originalText: "same-game challenge for the current target",
          targets: [{ ...TARGET_BINDING, alias: "CurrentAlias" }],
        }),
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");

    await expect(
      listVisibleDares(
        {
          serverId: SERVER,
          viewerDiscordId: CHALLENGER,
          scope: "mine",
          search: "currentalias",
        },
        db,
      ),
    ).resolves.toHaveLength(1);
    for (const hiddenSearch of [
      "Virmel",
      "virmel-puuid000000000000000000000000000000000000000000000000000000000000000000",
    ] as const) {
      await expect(
        listVisibleDares(
          {
            serverId: SERVER,
            viewerDiscordId: CHALLENGER,
            scope: "mine",
            search: hiddenSearch,
          },
          db,
        ),
      ).resolves.toEqual([]);
    }
  });

  test("funds once, freezes the revision, and binds the deadline on acceptance", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-1",
    });
    const results = await Promise.all([
      consume(fundIntent, CHALLENGER),
      consume(fundIntent, CHALLENGER),
    ]);
    expect(results.filter((result) => result.kind === "funded")).toHaveLength(
      1,
    );
    expect(await db.bucksDareContribution.count({ where: { dareId } })).toBe(1);

    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-1",
    });
    const accepted = await consume(acceptIntent, TARGET);
    expect(accepted.kind).toBe("accepted");
    const active = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(active.dareState).toBe("active");
    expect(active.fundedRevision).toBe(1);
    expect(active.deadlineAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(active.contractJson).not.toBeNull();
    if (active.contractJson === null) return;
    const contract = parseRelationalDareContract(active.contractJson);
    expect(contract.compilerVersion).toBe("dare-scoutql-3");
    const revision = await db.bucksDareRevision.findUniqueOrThrow({
      where: { dareId_revision: { dareId, revision: 1 } },
    });
    expect(revision.scoutQlImmutableAst).not.toBeNull();
    if (revision.scoutQlImmutableAst === null) return;
    expect(revision.scoutQlPlanHash).toBe(
      new Bun.CryptoHasher("sha256")
        .update(revision.scoutQlImmutableAst)
        .digest("hex"),
    );
    expect(contract.queryHash).toBe(revision.scoutQlPlanHash);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("refuses to fund a revision written by a retired compiler", async () => {
    const dareId = await makeDraft();
    await db.bucksDareRevision.update({
      where: { dareId_revision: { dareId, revision: 1 } },
      data: { compilerVersion: "dare-scoutql-2" },
    });
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-retired-compiler",
    });

    await expect(consume(fundIntent, CHALLENGER)).rejects.toThrow(
      "retired compiler dare-scoutql-2",
    );
    expect(await db.bucksDareContribution.count({ where: { dareId } })).toBe(0);
  });
});

describe("Dare absolute deadlines", () => {
  test("expires and fully refunds an acceptance after its absolute deadline", async () => {
    const deadlineAt = new Date(T0.getTime() + 60_000);
    const dareId = await makeDraft({
      deadlineSpec: {
        kind: "absolute",
        deadlineAt: deadlineAt.toISOString(),
        timezone: "America/Los_Angeles",
      },
    });
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-absolute-deadline",
    });
    const funded = await consume(fundIntent, CHALLENGER);
    expect(funded.kind).toBe("funded");
    await db.bucksDare.update({
      where: { id: dareId },
      data: { acceptDeadline: new Date(T0.getTime() + 24 * 60 * 60 * 1000) },
    });
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-after-absolute-deadline",
    });
    const accepted = await consumeDareConfirmationIntent(
      { intentId: acceptIntent, serverId: SERVER, actorDiscordId: TARGET },
      deps,
      new Date(T0.getTime() + 2 * 60_000),
    );

    expect(accepted.kind).toBe("accept_window_expired");
    const expired = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(expired.dareState).toBe("expired");
    await expectChallengerBalance(SEED_GRANT);
  });
});

describe("Dare draft mutation and cancellation", () => {
  test("rejects a stale funding revision after an immutable revision append", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraft(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: definition({
          originalText: "same dare, clarified to mean one game",
          openingStake: 25,
        }),
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");
    expect(await db.bucksDareRevision.count({ where: { dareId } })).toBe(2);
    const stale = await createDareConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { kind: "dare_fund" },
        idempotencyKey: "stale-fund",
      },
      deps,
      T0,
    );
    expect(stale).toEqual({ kind: "stale_revision", currentRevision: 2 });
  });

  test("binds an idempotency key to the complete confirmation payload", async () => {
    const dareId = await makeDraft();
    const first = await createDareConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: contribute(5),
        idempotencyKey: "contribute-payload",
      },
      deps,
      T0,
    );
    expect(first.kind).toBe("intent_created");

    const conflict = await createDareConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: contribute(10),
        idempotencyKey: "contribute-payload",
      },
      deps,
      T0,
    );
    expect(conflict).toEqual({ kind: "idempotency_conflict" });
  });

  test("creates one stable confirmation intent under concurrent retries", async () => {
    const dareId = await makeDraft();
    const input = {
      dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { kind: "dare_fund" } as const,
      idempotencyKey: "concurrent-fund-intent",
    };

    const [first, second] = await Promise.all([
      createDareConfirmationIntent(input, deps, T0),
      createDareConfirmationIntent(input, deps, T0),
    ]);

    expect(first.kind).toBe("intent_created");
    expect(second.kind).toBe("intent_created");
    if (first.kind !== "intent_created" || second.kind !== "intent_created") {
      throw new Error("Expected concurrent retries to return an intent.");
    }
    expect(second.intentId).toBe(first.intentId);
    expect(
      await db.confirmationIntent.count({
        where: { idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
  });
});

describe("Dare funded lifecycle", () => {
  test("challenger cancellation during acceptance refunds the full stake", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-cancel",
    });
    await consume(fundIntent, CHALLENGER);
    const cancelIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "cancel",
      key: "cancel-1",
    });
    const cancelled = await consume(cancelIntent, CHALLENGER);
    expect(cancelled.kind).toBe("cancelled");
    await expectChallengerBalance(SEED_GRANT);
  });

  test("refuses a contribution consumed after an active Dare deadline", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "contribution-deadline");
    const deadlineAt = new Date(T0.getTime() + 60_000);
    await db.bucksDare.update({
      where: { id: dareId },
      data: { deadlineAt },
    });
    const contribution = await createDareConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: contribute(5),
        idempotencyKey: "contribution-after-deadline",
      },
      deps,
      T0,
    );
    if (contribution.kind !== "intent_created") {
      throw new Error("Expected a contribution intent.");
    }

    await expect(
      consumeDareConfirmationIntent(
        {
          intentId: contribution.intentId,
          serverId: SERVER,
          actorDiscordId: CHALLENGER,
        },
        deps,
        new Date(deadlineAt.getTime() + 1),
      ),
    ).resolves.toMatchObject({ kind: "too_late", dareState: "active" });
    expect(await db.bucksDareContribution.count({ where: { dareId } })).toBe(1);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare partial settlement", () => {
  test("preserves an earlier committed summary when a later contract fails", async () => {
    const firstDareId = await makeDraft({ openingStake: 5 });
    const secondDareId = await makeDraft({ openingStake: 5 });
    await activate(firstDareId, "partial-first");
    await activate(secondDareId, "partial-second");
    await makeMonotone(firstDareId);
    await makeMonotone(secondDareId);
    lake.achieved = true;
    const match = matchAt(RiotMatchIdSchema.parse("NA1_9100000060"));
    lake.sourceMatchIds = [match.metadata.matchId];
    const partiallyFailingClient = clientFailingSecondTransaction(
      "simulated second Dare failure",
    );
    let caught: unknown;
    try {
      await settleDaresForMatch(match, partiallyFailingClient);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof DarePartialSettlementError)) {
      throw new Error(
        `Expected a DarePartialSettlementError, got ${String(caught)}.`,
      );
    }
    expect(caught.summaries).toMatchObject([
      { dareId: firstDareId, resolution: "achieved", value: true },
    ]);
    const firstDare = await db.bucksDare.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.bucksDare.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).toBe("achieved");
    expect(firstDare.calloutRefreshPending).toBe(true);
    expect(secondDare.dareState).toBe("active");
    await expect(settleDaresForMatch(match, db)).resolves.toMatchObject([
      { dareId: secondDareId, resolution: "achieved", value: true },
    ]);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("preserves deadline summaries when a later settlement fails", async () => {
    const firstDareId = await makeDraft({ openingStake: 5 });
    const secondDareId = await makeDraft({ openingStake: 5 });
    await activate(firstDareId, "deadline-partial-first");
    await activate(secondDareId, "deadline-partial-second");
    await db.bucksDare.updateMany({
      where: { id: { in: [firstDareId, secondDareId] } },
      data: { deadlineAt: new Date(T0.getTime() - 60 * 60 * 1000) },
    });
    const partiallyFailingClient = clientFailingSecondTransaction(
      "simulated deadline settlement failure",
    );
    let caught: unknown;
    try {
      await settleEndedDareWindows(
        partiallyFailingClient,
        new Date(T0.getTime() + 60 * 60 * 1000),
      );
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof DarePartialSettlementError)) {
      throw new Error(
        `Expected a DarePartialSettlementError, got ${String(caught)}.`,
      );
    }
    expect(caught.summaries).toHaveLength(1);
    expect(caught.summaries[0]?.dareId).toBe(firstDareId);
    const firstDare = await db.bucksDare.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.bucksDare.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).not.toBe("active");
    expect(secondDare.dareState).toBe("active");
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("activates exactly once when every target accepts concurrently", async () => {
    const dareId = await makeDraft({
      queryText: SHARED_WIN_SQL,
      targets: [TARGET_BINDING, SECOND_TARGET_BINDING],
    });
    await fund(dareId, "concurrent-acceptance");
    const firstIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-virmel",
    });
    const secondIntent = await intent({
      dareId,
      actor: SECOND_TARGET,
      action: "accept",
      key: "accept-bryan",
    });

    const outcomes = await Promise.all([
      consume(firstIntent, TARGET),
      consume(secondIntent, SECOND_TARGET),
    ]);

    expect(outcomes.every((outcome) => outcome.kind === "accepted")).toBe(true);
    expect(
      outcomes.filter(
        (outcome) => outcome.kind === "accepted" && outcome.activated,
      ),
    ).toHaveLength(1);
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
      include: { targets: true },
    });
    expect(dare.dareState).toBe("active");
    expect(dare.targets.every((target) => target.acceptedAt !== null)).toBe(
      true,
    );
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("conserves one wallet across concurrent contributions to distinct dares", async () => {
    const firstDareId = await makeDraft({ openingStake: 5 });
    const secondDareId = await makeDraft({ openingStake: 5 });
    await fund(firstDareId, "concurrent-contribution-first");
    await fund(secondDareId, "concurrent-contribution-second");
    const first = await createDareConfirmationIntent(
      {
        dareId: firstDareId,
        serverId: SERVER,
        actorDiscordId: CONTRIBUTOR,
        expectedRevision: 1,
        payload: contribute(15),
        idempotencyKey: "contribute-first-fifteen",
      },
      deps,
      T0,
    );
    const second = await createDareConfirmationIntent(
      {
        dareId: secondDareId,
        serverId: SERVER,
        actorDiscordId: CONTRIBUTOR,
        expectedRevision: 1,
        payload: contribute(15),
        idempotencyKey: "contribute-second-fifteen",
      },
      deps,
      T0,
    );
    if (first.kind !== "intent_created" || second.kind !== "intent_created") {
      throw new Error("Expected contribution confirmation intents.");
    }

    const outcomes = await Promise.all([
      consume(first.intentId, CONTRIBUTOR),
      consume(second.intentId, CONTRIBUTOR),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      "contributed",
      "insufficient",
    ]);
    const dares = await db.bucksDare.findMany({
      where: { id: { in: [firstDareId, secondDareId] } },
      orderBy: { potTotal: "asc" },
    });
    expect(dares.map((dare) => dare.potTotal)).toEqual([5, 20]);
    expect(
      await db.bucksDareContribution.aggregate({
        where: {
          dareId: { in: [firstDareId, secondDareId] },
          discordId: CONTRIBUTOR,
        },
        _sum: { amount: true },
      }),
    ).toMatchObject({ _sum: { amount: 15 } });
    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER, discordId: CONTRIBUTOR },
      },
    });
    expect(wallet.balance).toBe(SEED_GRANT - 15);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare evidence and settlement", () => {
  test("captures and pays one proof under concurrent match replay", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "achieved-replay");
    await makeMonotone(dareId);
    const match = matchAt(RiotMatchIdSchema.parse("NA1_9100000000"));
    lake.achieved = true;
    lake.sourceMatchIds = [match.metadata.matchId];

    const replayed = await Promise.all([
      settleDaresForMatch(match, db, {
        now: new Date(T0.getTime() + 90_000),
      }),
      settleDaresForMatch(match, db, {
        now: new Date(T0.getTime() + 91_000),
      }),
    ]);
    const summaries = replayed.flat();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      dareId,
      resolution: "achieved",
      value: true,
      proof: {
        planVersion: 3,
        compilerVersion: "dare-scoutql-3",
        evaluatorVersion: "dare-evaluator-3",
        qualifyingMatchIds: [match.metadata.matchId],
        targetKeys: ["T1"],
      },
    });
    expect(await db.bucksDareEvidence.count({ where: { dareId } })).toBe(1);
    const target = await db.bucksDareTarget.findFirstOrThrow({
      where: { dareId, targetKey: "T1" },
    });
    expect(target).toMatchObject({ payout: 16, fee: 4 });
    // The settling transaction names the match, so a resumed settlement can
    // still attest this Dare after its in-memory summary is gone.
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { settledMatchId: true },
      }),
    ).toEqual({ settledMatchId: match.metadata.matchId });
    if (target.bucksAccountId === null) {
      throw new Error("Accepted Dare target has no wallet.");
    }
    await expectSingleLedgerDelta(target.bucksAccountId, "dare_payout", 16);
    await expectSingleLedgerDelta(await houseAccountId(), "dare_fee", 4);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("serializes concurrent evidence and applies the unsuccessful cut at the bound", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "unachieved-bound");
    lake.achieved = false;

    await Promise.all([
      settleDaresForMatch(
        matchAt(RiotMatchIdSchema.parse("NA1_9100000020"), 60),
        db,
      ),
      settleDaresForMatch(
        matchAt(RiotMatchIdSchema.parse("NA1_9100000030"), 120),
        db,
      ),
    ]);
    expect(await db.bucksDareEvidence.count({ where: { dareId } })).toBe(2);
    const deadlineAt = await activeDareDeadline(dareId);
    const insideGrace = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS - 1,
    );
    await expect(settleEndedDareWindows(db, insideGrace)).resolves.toEqual([]);
    const boundAt = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1,
    );
    const settled = await settleEndedDareWindows(db, boundAt);

    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      dareId,
      resolution: "unachieved",
      value: false,
      finality: { final: true, reason: "deadline" },
    });
    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER, discordId: CHALLENGER },
      },
    });
    expect(wallet.balance).toBe(SEED_GRANT - 4);
    await expectSingleLedgerDelta(wallet.id, "dare_refund", 16);
    await expectSingleLedgerDelta(await houseAccountId(), "dare_fee", 4);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("voids and fully refunds a contract whose result stays unknowable", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "unknowable");
    lake.achieved = null;
    const captured = await settleDaresForMatch(
      matchAt(RiotMatchIdSchema.parse("NA1_9100000070")),
      db,
    );
    expect(captured).toMatchObject([
      { dareId, resolution: "captured", value: null },
    ]);
    const deadlineAt = await activeDareDeadline(dareId);
    const boundAt = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1,
    );
    const settled = await settleEndedDareWindows(db, boundAt);

    expect(settled).toMatchObject([
      {
        dareId,
        resolution: "voided",
        value: null,
        finality: { final: true, reason: "deadline" },
      },
    ]);
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(dare.voidReason).toBe("missing_evidence");
    // Resolved by the deadline, not by any match.
    expect(dare.settledMatchId).toBeNull();
    await expectChallengerBalance(SEED_GRANT);
  });

  test("voids a stored contract that no longer parses as invalid_contract", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "invalid-contract");
    await db.bucksDare.update({
      where: { id: dareId },
      data: { contractJson: JSON.stringify({ version: 2 }) },
    });

    await expect(
      settleDaresForMatch(
        matchAt(RiotMatchIdSchema.parse("NA1_9100000010")),
        db,
      ),
    ).resolves.toMatchObject([{ dareId, resolution: "voided", value: null }]);
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(dare.voidReason).toBe("invalid_contract");
    await expectChallengerBalance(SEED_GRANT);
  });
});

describe("Dare payout storage overflow", () => {
  test("voids and fully refunds an early-success payout that cannot fit", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "overflow-match");
    await makeMonotone(dareId);
    await fillTargetWallet(dareId);
    const match = matchAt(RiotMatchIdSchema.parse("NA1_9100000050"));
    lake.achieved = true;
    lake.sourceMatchIds = [match.metadata.matchId];

    const summaries = await settleDaresForMatch(match, db);

    expect(summaries).toMatchObject([
      { dareId, resolution: "voided", value: null },
    ]);
    await expectStorageOverflowVoid(dareId, 0);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { settledMatchId: true },
      }),
    ).toEqual({ settledMatchId: match.metadata.matchId });
  });

  test("voids and fully refunds a deadline payout that cannot fit", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "overflow-deadline");
    await fillTargetWallet(dareId);
    const match = matchAt(RiotMatchIdSchema.parse("NA1_9100000040"));
    lake.achieved = true;
    lake.sourceMatchIds = [match.metadata.matchId];
    await expect(settleDaresForMatch(match, db)).resolves.toMatchObject([
      { dareId, resolution: "captured", value: true },
    ]);
    const deadlineAt = await activeDareDeadline(dareId);

    const summaries = await settleEndedDareWindows(
      db,
      new Date(deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1),
    );

    expect(summaries).toMatchObject([
      { dareId, resolution: "voided", value: null },
    ]);
    await expectStorageOverflowVoid(dareId, 1);
  });
});
