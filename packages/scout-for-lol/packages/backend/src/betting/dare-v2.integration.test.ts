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
  DareCompiledPlanV2Schema,
  RawMatchSchema,
  type DareCompiledPlanV2,
  type DareDeadlineSpecV2,
  type DareTargetBindingV2,
  type DiscordAccountId,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  DARE_WINDOW_INGESTION_GRACE_MS,
  HOUSE_ACCOUNT_DISCORD_ID,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import {
  createDareDraftV2,
  reviseDareDraftV2,
} from "#src/betting/dare-draft-v2.ts";
import {
  postDareV2Callout,
  refreshDareV2Callout,
  refreshPendingDareV2Callouts,
} from "#src/betting/dare-callout-v2.ts";
import { DareV2PartialSettlementError } from "#src/betting/dare-settle-types-v2.ts";
import {
  inspectVisibleDareV2,
  listVisibleDaresV2,
} from "#src/betting/dare-view-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dare-intent-consume-v2.ts";
import { createDareV2ConfirmationIntent } from "#src/betting/dare-intent-v2.ts";
import { parseDareV2Contract } from "#src/betting/dare-v2-common.ts";
import { settleDaresV2ForMatch } from "#src/betting/dare-settle-v2.ts";
import { settleEndedDareV2Windows } from "#src/betting/dare-sweep-v2.ts";
import {
  DEATHCAP_TIMELINE_PLAN,
  makeTwistedFateMatch,
  TWISTED_FATE_SAME_GAME_PLAN,
} from "#src/betting/dare-v2-test-fixtures.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma: db } = createTestDatabase("bucks-dare-v2");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const SECOND_TARGET = testAccountId("925");
const CONTRIBUTOR = testAccountId("926");
const T0 = new Date("2026-09-01T12:00:00.000Z");
let matchFixture: RawMatch;

const TARGET_BINDING: DareTargetBindingV2 = {
  key: "virmel",
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

const SECOND_TARGET_BINDING: DareTargetBindingV2 = {
  key: "bryan",
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

const PLAN = TWISTED_FATE_SAME_GAME_PLAN;
const EXACTLY_ONE_PLAN = DareCompiledPlanV2Schema.parse({
  ...PLAN,
  result: { ...PLAN.result, operator: "eq", threshold: 1 },
});
const ARENA_PLAN = DareCompiledPlanV2Schema.parse({
  ...PLAN,
  gameSets: PLAN.gameSets.map((gameSet) => ({
    ...gameSet,
    queues: ["arena"],
  })),
});

const TWO_TARGET_PLAN = DareCompiledPlanV2Schema.parse({
  ...PLAN,
  gameSets: [
    {
      ...PLAN.gameSets[0],
      targetKeys: ["virmel", "bryan"],
      relationship: "same_team",
      predicate: {
        kind: "and",
        operands: [
          PLAN.gameSets[0]?.predicate,
          {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "bryan",
              field: "kills",
            },
            operator: "gte",
            threshold: 0,
          },
        ],
      },
    },
  ],
});

const deps = {
  prismaClient: db,
  isPolicyEnabled: async (name: Parameters<typeof addFlagOverride>[0]) =>
    name === "betting_enabled" ||
    name === "dare_v2" ||
    name === "scoutql_relational_enabled",
};

async function clearAll(): Promise<void> {
  await db.bucksDareV2ConfirmationIntent.deleteMany();
  await db.bucksDareV2Evidence.deleteMany();
  await db.bucksDareV2Contribution.deleteMany();
  await db.bucksDareV2Target.deleteMany();
  await db.bucksDareV2Revision.deleteMany();
  await db.bucksDareV2.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(async () => {
  await clearAll();
  for (const flag of [
    "betting_enabled",
    "dare_v2",
    "scoutql_relational_enabled",
  ] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

beforeAll(async () => {
  const fixture: unknown = await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json();
  matchFixture = RawMatchSchema.parse(fixture);
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("dare_v2");
  resetFlagOverrides("scoutql_relational_enabled");
  await clearAll();
  await db.$disconnect();
});

async function makeDraft(
  input: {
    plan?: DareCompiledPlanV2 | undefined;
    targets?: DareTargetBindingV2[] | undefined;
    deadlineSpec?: DareDeadlineSpecV2 | undefined;
    openingStake?: number | undefined;
  } = {},
) {
  const result = await createDareDraftV2(
    {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      originalText:
        "I bet Virmel can't get 8 CS/m on Twisted Fate in a game at least 20m",
      plan: input.plan ?? PLAN,
      targets: input.targets ?? [TARGET_BINDING],
      deadlineSpec: input.deadlineSpec ?? { kind: "relative", days: 7 },
      openingStake: input.openingStake ?? 20,
    },
    deps,
    T0,
  );
  if (result.kind !== "created")
    throw new Error("Expected Dare v2 draft creation.");
  return result.dareId;
}

function qualifyingArenaMatch(matchId: string): RawMatch {
  const match = qualifyingMatch(matchId);
  const additionalParticipants = Array.from({ length: 6 }, (_, index) => ({
    ...match.info.participants[index + 1],
    participantId: match.info.participants.length + index + 1,
    puuid: `arena-extra-${index.toString()}`,
  }));
  return RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      queueId: 1700,
      gameMode: "CHERRY",
      participants: [...match.info.participants, ...additionalParticipants],
    },
  });
}
async function fillTargetWallet(dareId: number): Promise<void> {
  const target = await db.bucksDareV2Target.findFirstOrThrow({
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
      delta: BUCKS_INT32_MAX - account.balance,
      kind: "adjustment",
      context: {
        type: "adjustment",
        note: "fill Dare v2 target wallet to the Int32 ceiling",
        actorDiscordId: CHALLENGER,
      },
    }),
  );
}
async function expectStorageOverflowVoid(
  dareId: number,
  evidenceCount: number,
): Promise<void> {
  const dare = await db.bucksDareV2.findUniqueOrThrow({
    where: { id: dareId },
  });
  expect(dare.dareState).toBe("voided");
  expect(dare.voidReason).toBe("storage_overflow");
  expect(await db.bucksDareV2Evidence.count({ where: { dareId } })).toBe(
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
  const result = await createDareV2ConfirmationIntent(
    {
      dareId: input.dareId,
      serverId: SERVER,
      actorDiscordId: input.actor,
      expectedRevision: 1,
      payload: { action: input.action },
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
  return await consumeDareV2ConfirmationIntent(
    { intentId, serverId: SERVER, actorDiscordId: actor },
    deps,
    T0,
  );
}

async function makeContribution(
  dareId: number,
  actor: DiscordAccountId,
  amount: number,
  key: string,
): Promise<void> {
  const result = await createDareV2ConfirmationIntent(
    {
      dareId,
      serverId: SERVER,
      actorDiscordId: actor,
      expectedRevision: 1,
      payload: { action: "contribute", amount },
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
  const active = await db.bucksDareV2.findUniqueOrThrow({
    where: { id: dareId },
    select: { deadlineAt: true },
  });
  if (active.deadlineAt === null) {
    throw new Error("Active Dare v2 has no deadline.");
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
  if (funded.kind !== "funded") throw new Error("Expected funded Dare v2.");
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
    throw new Error("Expected active Dare v2.");
  }
}

function matchWithStats(input: {
  matchId: string;
  minutesAfterActivation: number;
  timePlayed: number;
  creepScore: number;
}): RawMatch {
  const gameStartTimestamp =
    T0.getTime() + input.minutesAfterActivation * 60 * 1000;
  return makeTwistedFateMatch(matchFixture, {
    matchId: input.matchId,
    timePlayed: input.timePlayed,
    creepScore: input.creepScore,
    gameStartTimestamp,
  });
}

function qualifyingMatch(matchId: string): RawMatch {
  return matchWithStats({
    matchId,
    minutesAfterActivation: 60,
    timePlayed: 25 * 60,
    creepScore: 200,
  });
}

describe("Dare v2 draft and lifecycle", () => {
  test("keeps drafts private while exposing their frozen targets to the owner", async () => {
    const dareId = await makeDraft();
    const mine = await listVisibleDaresV2(
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
      listVisibleDaresV2(
        {
          serverId: SERVER,
          viewerDiscordId: CHALLENGER,
          scope: "mine",
          search: "Virmel",
        },
        db,
      ),
    ).resolves.toHaveLength(1);
    const inspected = await inspectVisibleDareV2(
      {
        dareId,
        serverId: SERVER,
        viewerDiscordId: CHALLENGER,
      },
      db,
    );
    expect(inspected?.plan).toEqual(PLAN);
    expect(inspected?.targets.map((target) => target.alias)).toEqual([
      "Virmel",
    ]);
    await expect(
      inspectVisibleDareV2(
        { dareId, serverId: SERVER, viewerDiscordId: TARGET },
        db,
      ),
    ).resolves.toBeNull();
    await expect(
      listVisibleDaresV2(
        { serverId: SERVER, viewerDiscordId: TARGET, scope: "guild" },
        db,
      ),
    ).resolves.toEqual([]);
  });

  test("searches only the active revision's visible text and aliases", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraftV2(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: {
          originalText: "same-game farming challenge for the current target",
          plan: PLAN,
          targets: [{ ...TARGET_BINDING, alias: "CurrentAlias" }],
          deadlineSpec: { kind: "relative", days: 7 },
          openingStake: 20,
        },
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");

    await expect(
      listVisibleDaresV2(
        {
          serverId: SERVER,
          viewerDiscordId: CHALLENGER,
          scope: "mine",
          search: "currentalias",
        },
        db,
      ),
    ).resolves.toHaveLength(1);
    for (const hiddenSearch of ["Virmel", "virmel-puuid", "virmel"] as const) {
      await expect(
        listVisibleDaresV2(
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
    expect(await db.bucksDareV2Contribution.count({ where: { dareId } })).toBe(
      1,
    );

    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-1",
    });
    const accepted = await consume(acceptIntent, TARGET);
    expect(accepted.kind).toBe("accepted");
    const active = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(active.dareState).toBe("active");
    expect(active.fundedRevision).toBe(1);
    expect(active.deadlineAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(active.contractJson).not.toBeNull();
    if (active.contractJson === null) return;
    const contract = parseDareV2Contract(active.contractJson);
    expect(contract.compilerVersion).toBe("dare-scoutql-2");
    expect("scoutQlPlanHash" in contract).toBe(false);
    const revision = await db.bucksDareV2Revision.findUniqueOrThrow({
      where: { dareId_revision: { dareId, revision: 1 } },
    });
    expect(revision.scoutQlImmutableAst).not.toBeNull();
    if (revision.scoutQlImmutableAst === null) return;
    expect(revision.scoutQlPlanHash).toBe(
      new Bun.CryptoHasher("sha256")
        .update(revision.scoutQlImmutableAst)
        .digest("hex"),
    );
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("activates a pre-artifact compiler-v2 revision", async () => {
    const dareId = await makeDraft();
    await db.bucksDareV2Revision.update({
      where: { dareId_revision: { dareId, revision: 1 } },
      data: { scoutQlImmutableAst: null, scoutQlPlanHash: null },
    });

    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-pre-artifact",
    });
    expect(await consume(fundIntent, CHALLENGER)).toMatchObject({
      kind: "funded",
    });
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-pre-artifact",
    });
    expect(await consume(acceptIntent, TARGET)).toMatchObject({
      kind: "accepted",
      activated: true,
    });

    const active = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(active.contractJson).not.toBeNull();
    if (active.contractJson === null) return;
    const contract = parseDareV2Contract(active.contractJson);
    expect(contract.compilerVersion).toBe("dare-scoutql-2");
    expect("scoutQlPlanHash" in contract).toBe(false);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare v2 absolute deadlines", () => {
  test("expires and fully refunds a legacy acceptance after its absolute deadline", async () => {
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
    await db.bucksDareV2.update({
      where: { id: dareId },
      data: { acceptDeadline: new Date(T0.getTime() + 24 * 60 * 60 * 1000) },
    });
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-after-absolute-deadline",
    });
    const accepted = await consumeDareV2ConfirmationIntent(
      { intentId: acceptIntent, serverId: SERVER, actorDiscordId: TARGET },
      deps,
      new Date(T0.getTime() + 2 * 60_000),
    );

    expect(accepted.kind).toBe("accept_window_expired");
    const expired = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(expired.dareState).toBe("expired");
    await expectChallengerBalance(SEED_GRANT);
  });
});

describe("Dare v2 draft mutation and cancellation", () => {
  test("rejects a stale funding revision after an immutable revision append", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraftV2(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: {
          originalText: "same dare, clarified to mean one game",
          plan: PLAN,
          targets: [TARGET_BINDING],
          deadlineSpec: { kind: "relative", days: 7 },
          openingStake: 25,
        },
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");
    expect(await db.bucksDareV2Revision.count({ where: { dareId } })).toBe(2);
    const stale = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "fund" },
        idempotencyKey: "stale-fund",
      },
      deps,
      T0,
    );
    expect(stale).toEqual({ kind: "stale_revision", currentRevision: 2 });
  });

  test("binds an idempotency key to the complete confirmation payload", async () => {
    const dareId = await makeDraft();
    const first = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 5 },
        idempotencyKey: "contribute-payload",
      },
      deps,
      T0,
    );
    expect(first.kind).toBe("intent_created");

    const conflict = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 10 },
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
      payload: { action: "fund" } as const,
      idempotencyKey: "concurrent-fund-intent",
    };

    const [first, second] = await Promise.all([
      createDareV2ConfirmationIntent(input, deps, T0),
      createDareV2ConfirmationIntent(input, deps, T0),
    ]);

    expect(first.kind).toBe("intent_created");
    expect(second.kind).toBe("intent_created");
    if (first.kind !== "intent_created" || second.kind !== "intent_created") {
      throw new Error("Expected concurrent retries to return an intent.");
    }
    expect(second.intentId).toBe(first.intentId);
    expect(
      await db.bucksDareV2ConfirmationIntent.count({
        where: { idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
  });
});

describe("Dare v2 funded lifecycle", () => {
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
    await db.bucksDareV2.update({
      where: { id: dareId },
      data: { deadlineAt },
    });
    const contribution = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 5 },
        idempotencyKey: "contribution-after-deadline",
      },
      deps,
      T0,
    );
    if (contribution.kind !== "intent_created") {
      throw new Error("Expected a contribution intent.");
    }

    await expect(
      consumeDareV2ConfirmationIntent(
        {
          intentId: contribution.intentId,
          serverId: SERVER,
          actorDiscordId: CHALLENGER,
        },
        deps,
        new Date(deadlineAt.getTime() + 1),
      ),
    ).resolves.toMatchObject({ kind: "too_late", dareState: "active" });
    expect(await db.bucksDareV2Contribution.count({ where: { dareId } })).toBe(
      1,
    );
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare v2 queue capture", () => {
  test("captures a completed stat-only Arena game", async () => {
    const dareId = await makeDraft({ plan: ARENA_PLAN });
    await activate(dareId, "arena-stat-contract");

    await expect(
      settleDaresV2ForMatch(qualifyingArenaMatch("NA1_DARE_V2_ARENA_STAT"), db),
    ).resolves.toMatchObject([{ dareId, resolution: "achieved", value: true }]);
    await expect(
      db.bucksDareV2Evidence.count({ where: { dareId } }),
    ).resolves.toBe(1);
  });
});

describe("Dare v2 partial settlement", () => {
  test("preserves an earlier committed summary when a later contract fails", async () => {
    const firstDareId = await makeDraft({ openingStake: 5 });
    const secondDareId = await makeDraft({ openingStake: 5 });
    await activate(firstDareId, "partial-first");
    await activate(secondDareId, "partial-second");
    const partiallyFailingClient = clientFailingSecondTransaction(
      "simulated second Dare v2 failure",
    );
    const match = qualifyingMatch("NA1_DARE_V2_PARTIAL");
    let caught: unknown;
    try {
      await settleDaresV2ForMatch(match, partiallyFailingClient);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof DareV2PartialSettlementError)) {
      throw new Error(
        `Expected a DareV2PartialSettlementError, got ${String(caught)}.`,
      );
    }
    expect(caught.summaries).toMatchObject([
      { dareId: firstDareId, resolution: "achieved", value: true },
    ]);
    const firstDare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).toBe("achieved");
    expect(firstDare.calloutRefreshPending).toBe(true);
    expect(secondDare.dareState).toBe("active");
    await expect(settleDaresV2ForMatch(match, db)).resolves.toMatchObject([
      { dareId: secondDareId, resolution: "achieved", value: true },
    ]);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("preserves deadline summaries when a later settlement fails", async () => {
    const firstDareId = await makeDraft({ openingStake: 5 });
    const secondDareId = await makeDraft({ openingStake: 5 });
    await activate(firstDareId, "deadline-partial-first");
    await activate(secondDareId, "deadline-partial-second");
    await db.bucksDareV2.updateMany({
      where: { id: { in: [firstDareId, secondDareId] } },
      data: { deadlineAt: new Date(T0.getTime() - 60 * 60 * 1000) },
    });
    const partiallyFailingClient = clientFailingSecondTransaction(
      "simulated deadline settlement failure",
    );
    let caught: unknown;
    try {
      await settleEndedDareV2Windows(
        partiallyFailingClient,
        new Date(T0.getTime() + 60 * 60 * 1000),
      );
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof DareV2PartialSettlementError)) {
      throw new Error(
        `Expected a DareV2PartialSettlementError, got ${String(caught)}.`,
      );
    }
    expect(caught.summaries).toHaveLength(1);
    expect(caught.summaries[0]?.dareId).toBe(firstDareId);
    const firstDare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).not.toBe("active");
    expect(secondDare.dareState).toBe("active");
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("activates exactly once when every target accepts concurrently", async () => {
    const dareId = await makeDraft({
      plan: TWO_TARGET_PLAN,
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
    const dare = await db.bucksDareV2.findUniqueOrThrow({
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
    const first = await createDareV2ConfirmationIntent(
      {
        dareId: firstDareId,
        serverId: SERVER,
        actorDiscordId: CONTRIBUTOR,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 15 },
        idempotencyKey: "contribute-first-fifteen",
      },
      deps,
      T0,
    );
    const second = await createDareV2ConfirmationIntent(
      {
        dareId: secondDareId,
        serverId: SERVER,
        actorDiscordId: CONTRIBUTOR,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 15 },
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
    const dares = await db.bucksDareV2.findMany({
      where: { id: { in: [firstDareId, secondDareId] } },
      orderBy: { potTotal: "asc" },
    });
    expect(dares.map((dare) => dare.potTotal)).toEqual([5, 20]);
    expect(
      await db.bucksDareV2Contribution.aggregate({
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

describe("Dare v2 evidence and settlement", () => {
  test("captures and pays one proof under concurrent match replay", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "achieved-replay");
    const match = matchWithStats({
      matchId: "NA1_DARE_V2_ACHIEVED",
      minutesAfterActivation: 60,
      timePlayed: 25 * 60,
      creepScore: 200,
    });

    const replayed = await Promise.all([
      settleDaresV2ForMatch(match, db, {
        now: new Date(T0.getTime() + 90_000),
      }),
      settleDaresV2ForMatch(match, db, {
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
        planVersion: 2,
        compilerVersion: "dare-scoutql-2",
        evaluatorVersion: "dare-evaluator-2",
        qualifyingMatchIds: [match.metadata.matchId],
        targetKeys: ["virmel"],
      },
    });
    expect(await db.bucksDareV2Evidence.count({ where: { dareId } })).toBe(1);
    const target = await db.bucksDareV2Target.findFirstOrThrow({
      where: { dareId, targetKey: "virmel" },
    });
    expect(target).toMatchObject({ payout: 16, fee: 4 });
    if (target.bucksAccountId === null) {
      throw new Error("Accepted Dare v2 target has no wallet.");
    }
    await expectSingleLedgerDelta(target.bucksAccountId, "dare_payout", 16);
    await expectSingleLedgerDelta(await houseAccountId(), "dare_fee", 4);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("serializes concurrent evidence and applies the unsuccessful cut at the bound", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "unachieved-bound");
    const firstMatch = matchWithStats({
      matchId: "NA1_DARE_V2_MISS_A",
      minutesAfterActivation: 60,
      timePlayed: 25 * 60,
      creepScore: 100,
    });
    const secondMatch = matchWithStats({
      matchId: "NA1_DARE_V2_MISS_B",
      minutesAfterActivation: 120,
      timePlayed: 25 * 60,
      creepScore: 100,
    });

    await Promise.all([
      settleDaresV2ForMatch(firstMatch, db),
      settleDaresV2ForMatch(secondMatch, db),
    ]);
    expect(await db.bucksDareV2Evidence.count({ where: { dareId } })).toBe(2);
    const deadlineAt = await activeDareDeadline(dareId);
    const insideGrace = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS - 1,
    );
    await expect(settleEndedDareV2Windows(db, insideGrace)).resolves.toEqual(
      [],
    );
    const boundAt = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1,
    );
    const settled = await settleEndedDareV2Windows(db, boundAt);

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

  test("voids and fully refunds a timeline contract that remains unknowable", async () => {
    const dareId = await makeDraft({ plan: DEATHCAP_TIMELINE_PLAN });
    await activate(dareId, "missing-timeline");
    const match = matchWithStats({
      matchId: "NA1_DARE_V2_NO_TIMELINE",
      minutesAfterActivation: 60,
      timePlayed: 25 * 60,
      creepScore: 200,
    });
    const captured = await settleDaresV2ForMatch(match, db, {
      timeline: { coverage: "missing", events: [], participants: [] },
    });
    expect(captured).toMatchObject([
      { dareId, resolution: "captured", value: null },
    ]);
    const deadlineAt = await activeDareDeadline(dareId);
    const boundAt = new Date(
      deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1,
    );
    const settled = await settleEndedDareV2Windows(db, boundAt);

    expect(settled).toMatchObject([
      {
        dareId,
        resolution: "voided",
        value: null,
        finality: { final: true, reason: "deadline" },
      },
    ]);
    const dare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(dare.voidReason).toBe("missing_evidence");
    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER, discordId: CHALLENGER },
      },
    });
    expect(wallet.balance).toBe(SEED_GRANT);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare v2 payout storage overflow", () => {
  test("voids and fully refunds an early-success payout that cannot fit", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "overflow-match");
    await fillTargetWallet(dareId);

    const summaries = await settleDaresV2ForMatch(
      qualifyingMatch("NA1_DARE_V2_OVERFLOW_MATCH"),
      db,
    );

    expect(summaries).toMatchObject([
      { dareId, resolution: "voided", value: null },
    ]);
    await expectStorageOverflowVoid(dareId, 0);
  });

  test("voids and fully refunds a deadline payout that cannot fit", async () => {
    const dareId = await makeDraft({ plan: EXACTLY_ONE_PLAN });
    await activate(dareId, "overflow-deadline");
    await fillTargetWallet(dareId);
    await expect(
      settleDaresV2ForMatch(
        qualifyingMatch("NA1_DARE_V2_OVERFLOW_DEADLINE"),
        db,
      ),
    ).resolves.toMatchObject([{ dareId, resolution: "captured", value: true }]);
    const active = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    if (active.deadlineAt === null) {
      throw new Error("Expected the active Dare v2 to have a deadline.");
    }

    const summaries = await settleEndedDareV2Windows(
      db,
      new Date(
        active.deadlineAt.getTime() + DARE_WINDOW_INGESTION_GRACE_MS + 1,
      ),
    );

    expect(summaries).toMatchObject([
      { dareId, resolution: "voided", value: null },
    ]);
    await expectStorageOverflowVoid(dareId, 1);
  });
});

describe("Dare v2 callout delivery", () => {
  test("concurrent funding replays publish one durable public callout", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-callout",
    });
    await consume(fundIntent, CHALLENGER);
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "callout-message" }),
    );
    const calloutDependencies = {
      prismaClient: db,
      sendMessage,
      editMessage: vi.fn(() => Promise.resolve()),
    };

    const results = await Promise.all([
      postDareV2Callout(dareId, calloutDependencies),
      postDareV2Callout(dareId, calloutDependencies),
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
    const dare = await db.bucksDareV2.findUniqueOrThrow({
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

  test("persists a failed callout edit for a later retry", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-callout-edit",
    });
    await consume(fundIntent, CHALLENGER);
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "callout-edit-message" }),
      ),
      editMessage: vi.fn(() =>
        Promise.reject(new Error("Discord edit failed")),
      ),
    };
    await postDareV2Callout(dareId, dependencies);
    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-before-callout-edit",
    });
    await consume(acceptIntent, TARGET);

    await expect(refreshDareV2Callout(dareId, dependencies)).rejects.toThrow(
      "Discord edit failed",
    );
    expect(dependencies.editMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });

    const retryEditor = vi.fn(() => Promise.resolve());
    await expect(
      refreshPendingDareV2Callouts({
        ...dependencies,
        editMessage: retryEditor,
      }),
    ).resolves.toEqual([dareId]);
    expect(retryEditor).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("does not clear refresh work created during a callout edit", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-concurrent-callout-edit",
    });
    await consume(fundIntent, CHALLENGER);
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.resolve({ channelId: CHANNEL, id: "concurrent-edit-message" }),
      ),
      editMessage: vi.fn(async () => {
        await db.bucksDareV2.update({
          where: { id: dareId },
          data: {
            calloutRefreshPending: true,
            calloutRefreshVersion: { increment: 1 },
          },
        });
      }),
    };
    await postDareV2Callout(dareId, dependencies);
    await db.bucksDareV2.update({
      where: { id: dareId },
      data: {
        calloutRefreshPending: true,
        calloutRefreshVersion: { increment: 1 },
      },
    });

    await refreshDareV2Callout(dareId, dependencies);

    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: true });
  });

  test("propagates a failed initial callout send for retry", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-callout-send-failure",
    });
    await consume(fundIntent, CHALLENGER);
    const dependencies = {
      prismaClient: db,
      sendMessage: vi.fn(() =>
        Promise.reject(new Error("Discord send failed")),
      ),
      editMessage: vi.fn(() => Promise.resolve()),
    };

    await expect(postDareV2Callout(dareId, dependencies)).rejects.toThrow(
      "Discord send failed",
    );
    expect(dependencies.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dareId },
        select: { calloutRefreshPending: true, messageRef: true },
      }),
    ).toEqual({ calloutRefreshPending: true, messageRef: null });

    const retrySender = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "retried-callout-message" }),
    );
    await expect(
      refreshPendingDareV2Callouts({
        ...dependencies,
        sendMessage: retrySender,
      }),
    ).resolves.toEqual([dareId]);
    expect(retrySender).toHaveBeenCalledTimes(1);
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
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

describe("Dare v2 callout contributor delivery", () => {
  test("renders pile-ons and allows contributor mentions on post and refresh", async () => {
    const dareId = await makeDraft({ openingStake: 10 });
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-callout-contributor",
    });
    await consume(fundIntent, CHALLENGER);
    await makeContribution(dareId, CONTRIBUTOR, 5, "contributor-callout-first");

    const sendMessage = vi.fn(() =>
      Promise.resolve({
        channelId: CHANNEL,
        id: "contributor-callout-message",
      }),
    );
    const editMessage = vi.fn(() => Promise.resolve());
    const dependencies = { prismaClient: db, sendMessage, editMessage };

    await postDareV2Callout(dareId, dependencies);
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
    await refreshDareV2Callout(dareId, dependencies);

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
