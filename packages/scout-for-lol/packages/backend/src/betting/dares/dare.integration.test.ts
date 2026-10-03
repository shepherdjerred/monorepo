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
  DareContractSchema,
  DareSqlEvidenceSchema,
  StorableBucksStakeSchema,
  RawMatchSchema,
  type DareDeadlineSpec,
  type DareSqlEvidence,
  type DareTargetBinding,
  type DiscordAccountId,
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
import { makeTwistedFateMatch } from "#src/betting/dares/dare-test-fixtures.ts";

/**
 * The Dare lifecycle end to end: drafting, funding, acceptance, contribution,
 * evidence capture, settlement, refunds, and the public callout.
 *
 * The SQL compiler is real, so drafts carry a genuine frozen AST and query
 * hash. Only lake execution is stubbed: each test says what the contract's
 * evidence is, and everything from the evidence down — finality, the money,
 * the callout — runs for real.
 */

type LakeEvidence = { achieved: boolean | null; sourceMatchIds: string[] };
const lake = vi.hoisted((): LakeEvidence => ({
  achieved: false,
  sourceMatchIds: [],
}));

vi.mock("#src/betting/dares/sql/dare-sql.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/betting/dares/sql/dare-sql.ts",
  );
  return {
    ...actual,
    executeDareSql: (input: {
      compilation: { queryHash: string };
      targets: readonly { key: string }[];
    }): Promise<DareSqlEvidence> =>
      Promise.resolve(
        DareSqlEvidenceSchema.parse({
          achieved: lake.achieved,
          results: [],
          targetDependencies: input.targets.map((target) => target.key),
          coverage: "complete",
          sourceMatchIds: lake.sourceMatchIds,
          queryHash: input.compilation.queryHash,
        }),
      ),
    decisiveTargetDependencies: (input: {
      targets: readonly { key: string }[];
    }) => Promise.resolve(input.targets.map((target) => target.key)),
  };
});

const { createDareDraft, reviseDareDraft } =
  await import("#src/betting/dares/lifecycle/dare-draft.ts");
const { postDareCallout, refreshDareCallout, refreshPendingDareCallouts } =
  await import("#src/betting/dares/presentation/dare-callout.ts");
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
const ONE_WIN_SQL = "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.win";
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
      puuid: "virmel-puuid",
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
      puuid: "bryan-puuid",
      trackingStartedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const deps = {
  prismaClient: db,
  isPolicyEnabled: async (name: Parameters<typeof addFlagOverride>[0]) =>
    name === "betting_enabled" || name === "bucks_dares_enabled",
};

async function clearAll(): Promise<void> {
  await db.matchNotificationIntent.deleteMany();
  await db.confirmationIntent.deleteMany();
  await db.bucksDareEvidence.deleteMany();
  await db.bucksDareContribution.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDareRevision.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
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
  const fixture: unknown = await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json();
  matchFixture = RawMatchSchema.parse(fixture);
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("bucks_dares_enabled");
  await clearAll();
  await db.$disconnect();
});

function definition(
  input: {
    queryText?: string | undefined;
    targets?: DareTargetBinding[] | undefined;
    deadlineSpec?: DareDeadlineSpec | undefined;
    openingStake?: number | undefined;
    originalText?: string | undefined;
  } = {},
) {
  return {
    originalText:
      input.originalText ?? "I bet Virmel can't win a game on Twisted Fate",
    queryText: input.queryText ?? ONE_WIN_SQL,
    plainLanguage: "Virmel wins at least one eligible game.",
    targets: input.targets ?? [TARGET_BINDING],
    deadlineSpec: input.deadlineSpec ?? { kind: "relative", days: 7 },
    openingStake: input.openingStake ?? 20,
  };
}

async function makeDraft(input: Parameters<typeof definition>[0] = {}) {
  const result = await createDareDraft(
    {
      ...definition(input),
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
    },
    deps,
    T0,
  );
  if (result.kind !== "created")
    throw new Error(`Expected Dare draft creation, got ${result.kind}.`);
  return result.dareId;
}

/**
 * Freeze an active contract as monotone, so a satisfied match settles it
 * immediately rather than at its deadline.
 */
async function makeMonotone(dareId: number): Promise<void> {
  const active = await db.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    select: { contractJson: true },
  });
  if (active.contractJson === null) throw new Error("Dare is not active.");
  const contract = DareContractSchema.parse(JSON.parse(active.contractJson));
  await db.bucksDare.update({
    where: { id: dareId },
    data: {
      contractJson: JSON.stringify({ ...contract, finality: "monotone_true" }),
    },
  });
}

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

async function intent(input: {
  dareId: number;
  actor: DiscordAccountId;
  action: "fund" | "accept" | "decline" | "cancel";
  key: string;
}) {
  const payload =
    input.action === "fund"
      ? ({ kind: "dare_fund" } as const)
      : input.action === "accept"
        ? ({ kind: "dare_accept" } as const)
        : input.action === "decline"
          ? ({ kind: "dare_decline" } as const)
          : ({ kind: "dare_cancel" } as const);
  const result = await createDareConfirmationIntent(
    {
      dareId: input.dareId,
      serverId: SERVER,
      actorDiscordId: input.actor,
      expectedRevision: 1,
      payload,
      idempotencyKey: input.key,
    },
    deps,
    T0,
  );
  if (result.kind !== "intent_created")
    throw new Error("Expected confirmation intent.");
  return result.intentId;
}

async function consume(intentId: string, actor: DiscordAccountId) {
  return await consumeDareConfirmationIntent(
    { intentId, serverId: SERVER, actorDiscordId: actor },
    deps,
    T0,
  );
}

const contribute = (amount: number) => ({
  kind: "dare_contribute" as const,
  amount: StorableBucksStakeSchema.parse(amount),
});

async function makeContribution(
  dareId: number,
  actor: DiscordAccountId,
  amount: number,
  key: string,
): Promise<void> {
  const result = await createDareConfirmationIntent(
    {
      dareId,
      serverId: SERVER,
      actorDiscordId: actor,
      expectedRevision: 1,
      payload: contribute(amount),
      idempotencyKey: key,
    },
    deps,
    T0,
  );
  if (result.kind !== "intent_created") {
    throw new Error("Expected contribution intent.");
  }
  await consume(result.intentId, actor);
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

async function fund(dareId: number, key: string): Promise<void> {
  const fundIntent = await intent({
    dareId,
    actor: CHALLENGER,
    action: "fund",
    key,
  });
  const funded = await consume(fundIntent, CHALLENGER);
  if (funded.kind !== "funded")
    throw new Error(`Expected funded Dare, got ${funded.kind}.`);
}

async function activate(dareId: number, key: string): Promise<void> {
  await fund(dareId, `fund-${key}`);
  const acceptIntent = await intent({
    dareId,
    actor: TARGET,
    action: "accept",
    key: `accept-${key}`,
  });
  const accepted = await consume(acceptIntent, TARGET);
  if (accepted.kind !== "accepted" || !accepted.activated) {
    throw new Error("Expected active Dare.");
  }
}

function matchAt(matchId: string, minutesAfterActivation = 60): RawMatch {
  return makeTwistedFateMatch(matchFixture, {
    matchId,
    timePlayed: 25 * 60,
    creepScore: 200,
    gameStartTimestamp: T0.getTime() + minutesAfterActivation * 60 * 1000,
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
    for (const hiddenSearch of ["Virmel", "virmel-puuid"] as const) {
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
    const match = matchAt("NA1_DARE_PARTIAL");
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
    const match = matchAt("NA1_DARE_ACHIEVED");
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
      settleDaresForMatch(matchAt("NA1_DARE_MISS_A", 60), db),
      settleDaresForMatch(matchAt("NA1_DARE_MISS_B", 120), db),
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
      matchAt("NA1_DARE_UNKNOWABLE"),
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
      settleDaresForMatch(matchAt("NA1_DARE_INVALID_CONTRACT"), db),
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
    const match = matchAt("NA1_DARE_OVERFLOW_MATCH");
    lake.achieved = true;
    lake.sourceMatchIds = [match.metadata.matchId];

    const summaries = await settleDaresForMatch(match, db);

    expect(summaries).toMatchObject([
      { dareId, resolution: "voided", value: null },
    ]);
    await expectStorageOverflowVoid(dareId, 0);
  });

  test("voids and fully refunds a deadline payout that cannot fit", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "overflow-deadline");
    await fillTargetWallet(dareId);
    const match = matchAt("NA1_DARE_OVERFLOW_DEADLINE");
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

describe("Dare callout delivery", () => {
  test("concurrent funding replays publish one durable public callout", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout");
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "callout-message" }),
    );
    const calloutDependencies = {
      prismaClient: db,
      sendMessage,
      editMessage: vi.fn(() => Promise.resolve()),
    };

    const results = await Promise.all([
      postDareCallout(dareId, calloutDependencies),
      postDareCallout(dareId, calloutDependencies),
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: `dare-v2-${dareId.toString()}`,
        enforceNonce: true,
      }),
      CHANNEL,
      SERVER,
    );
    expect(results.map((result) => result.kind).sort()).toEqual([
      "existing",
      "posted",
    ]);
    const dare = await db.bucksDare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(JSON.parse(dare.messageRef ?? "null")).toEqual({
      channelId: CHANNEL,
      messageId: "callout-message",
    });
    expect(dare.calloutClaimId).toBeNull();
    expect(dare.calloutClaimedAt).toBeNull();
    expect(dare.calloutRefreshPending).toBe(false);
  });
});

describe("Dare callout retries", () => {
  test("persists a failed callout edit for a later retry", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "callout-edit-message" }),
      ),
      editMessage: vi.fn(() =>
        Promise.reject(new Error("Discord edit failed")),
      ),
    };
    await postDareCallout(dareId, dependencies);
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-before-callout-edit",
    });
    await consume(acceptIntent, TARGET);

    await expect(refreshDareCallout(dareId, dependencies)).rejects.toThrow(
      "Discord edit failed",
    );
    expect(dependencies.editMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });

    const retryEditor = vi.fn(() => Promise.resolve());
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        editMessage: retryEditor,
      }),
    ).resolves.toEqual([dareId]);
    expect(retryEditor).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("does not clear refresh work created during a callout edit", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-concurrent-callout-edit");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "concurrent-edit-message" }),
      ),
      editMessage: vi.fn(async () => {
        await db.bucksDare.update({
          where: { id: dareId },
          data: {
            calloutRefreshPending: true,
            calloutRefreshVersion: { increment: 1 },
          },
        });
      }),
    };
    await postDareCallout(dareId, dependencies);
    await db.bucksDare.update({
      where: { id: dareId },
      data: {
        calloutRefreshPending: true,
        calloutRefreshVersion: { increment: 1 },
      },
    });

    await refreshDareCallout(dareId, dependencies);

    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });

  test("propagates a failed initial callout send for retry", async () => {
    const dareId = await makeDraft();
    await fund(dareId, "fund-callout-send-failure");
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.reject(new Error("Discord send failed")),
      ),
      editMessage: vi.fn(() => Promise.resolve()),
    };

    await expect(postDareCallout(dareId, dependencies)).rejects.toThrow(
      "Discord send failed",
    );
    expect(dependencies.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({ calloutRefreshPending: true, messageRef: null });

    const retrySender = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "retried-callout-message" }),
    );
    await expect(
      refreshPendingDareCallouts({
        ...dependencies,
        sendMessage: retrySender,
      }),
    ).resolves.toEqual([dareId]);
    expect(retrySender).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({
      calloutRefreshPending: false,
      messageRef: JSON.stringify({
        channelId: CHANNEL,
        messageId: "retried-callout-message",
      }),
    });
  });
});

describe("Dare callout contributor delivery", () => {
  test("renders pile-ons and allows contributor mentions on post and refresh", async () => {
    const dareId = await makeDraft({ openingStake: 10 });
    await fund(dareId, "fund-callout-contributor");
    await makeContribution(dareId, CONTRIBUTOR, 5, "contributor-callout-first");

    const sendMessage = vi.fn(() =>
      Promise.resolve({
        channelId: CHANNEL,
        id: "contributor-callout-message",
      }),
    );
    const editMessage = vi.fn(() => Promise.resolve());
    const dependencies = { prismaClient: db, sendMessage, editMessage };

    await postDareCallout(dareId, dependencies);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(`<@${CONTRIBUTOR}> — **5 BB**`),
        allowedMentions: expect.objectContaining({
          users: expect.arrayContaining([CONTRIBUTOR]),
        }),
      }),
      CHANNEL,
      SERVER,
    );

    await makeContribution(
      dareId,
      CONTRIBUTOR,
      5,
      "contributor-callout-second",
    );
    await refreshDareCallout(dareId, dependencies);

    expect(editMessage).toHaveBeenCalledWith({
      channelId: CHANNEL,
      messageId: "contributor-callout-message",
      options: expect.objectContaining({
        content: expect.stringContaining(`<@${CONTRIBUTOR}> — **10 BB**`),
        allowedMentions: {
          parse: [],
          users: expect.arrayContaining([CONTRIBUTOR]),
        },
      }),
    });
  });
});
