import { lake } from "#src/dares/dare-lake.test-fixtures.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/dares/constants.ts";
import {
  clearDareTables,
  createDareLifecycleHarness,
  freezeDareAsMonotone,
} from "#src/dares/dare-integration.test-fixtures.ts";
import {
  dareTargetBinding,
  loadRiftFixture,
  targetMatchAt,
} from "#src/dares/dare-test-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { type DareTargetBinding, type RawMatch } from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

/**
 * The Dare lifecycle end to end: drafting, publishing, acceptance,
 * evidence capture, resolution, and the public callout.
 *
 * The SQL compiler is real, so drafts carry a genuine frozen AST and query
 * hash. Only lake execution is stubbed: each test says what the contract's
 * evidence is, and everything from the evidence down — finality and
 * the callout — runs for real.
 */

const { reviseDareDraft } = await import("#src/dares/lifecycle/dare-draft.ts");
const { DarePartialSettlementError } =
  await import("#src/dares/settlement/dare-settle-types.ts");
const { inspectVisibleDare, listVisibleDares } =
  await import("#src/dares/presentation/dare-view.ts");
const { consumeDareConfirmationIntent } =
  await import("#src/dares/lifecycle/dare-intent-consume.ts");
const { createDareConfirmationIntent } =
  await import("#src/dares/lifecycle/dare-intent.ts");
const { parseRelationalDareContract } =
  await import("#src/dares/dare-common.ts");
const { settleDaresForMatch } =
  await import("#src/dares/settlement/dare-settle.ts");
const { settleEndedDareWindows } =
  await import("#src/dares/settlement/dare-sweep.ts");

const { prisma: db } = createTestDatabase("bucks-dare");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const SECOND_TARGET = testAccountId("925");
const T0 = new Date("2026-09-01T12:00:00.000Z");
const SHARED_WIN_SQL =
  "SELECT COUNT(*) >= 1 AS achieved FROM T1 a JOIN T2 b USING (match_id) WHERE a.win";
let matchFixture: RawMatch;

const TARGET_BINDING = dareTargetBinding(TARGET);

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

const { deps, definition, makeDraft, intent, consume, publish, activate } =
  createDareLifecycleHarness({
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
  for (const flag of ["dares_enabled"] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

beforeAll(async () => {
  matchFixture = await loadRiftFixture();
});

afterAll(async () => {
  resetFlagOverrides("dares_enabled");
  await clearAll();
  await db.$disconnect();
});

async function activeDareDeadline(dareId: number): Promise<Date> {
  const active = await db.dare.findUniqueOrThrow({
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

  test("publishes once, freezes the revision, and binds the deadline on acceptance", async () => {
    const dareId = await makeDraft();
    const publishIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "publish",
      key: "publish-1",
    });
    const results = await Promise.all([
      consume(publishIntent, CHALLENGER),
      consume(publishIntent, CHALLENGER),
    ]);
    expect(
      results.filter((result) => result.kind === "published"),
    ).toHaveLength(1);

    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-1",
    });
    const accepted = await consume(acceptIntent, TARGET);
    expect(accepted.kind).toBe("accepted");
    const active = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(active.dareState).toBe("active");
    expect(active.publishedRevision).toBe(1);
    expect(active.deadlineAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(active.contractJson).not.toBeNull();
    if (active.contractJson === null) return;
    const contract = parseRelationalDareContract(active.contractJson);
    expect(contract.compilerVersion).toBe("dare-scoutql-3");
    const revision = await db.dareRevision.findUniqueOrThrow({
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
  });

  test("refuses to publish a revision written by a retired compiler", async () => {
    const dareId = await makeDraft();
    await db.dareRevision.update({
      where: { dareId_revision: { dareId, revision: 1 } },
      data: { compilerVersion: "dare-scoutql-2" },
    });
    const publishIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "publish",
      key: "publish-retired-compiler",
    });

    await expect(consume(publishIntent, CHALLENGER)).rejects.toThrow(
      "retired compiler dare-scoutql-2",
    );
  });
});

describe("Dare absolute deadlines", () => {
  test("expires an acceptance after its absolute deadline", async () => {
    const deadlineAt = new Date(T0.getTime() + 60_000);
    const dareId = await makeDraft({
      deadlineSpec: {
        kind: "absolute",
        deadlineAt: deadlineAt.toISOString(),
        timezone: "America/Los_Angeles",
      },
    });
    const publishIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "publish",
      key: "publish-absolute-deadline",
    });
    const published = await consume(publishIntent, CHALLENGER);
    expect(published.kind).toBe("published");
    await db.dare.update({
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
    const expired = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(expired.dareState).toBe("expired");
  });
});

describe("Dare draft mutation and cancellation", () => {
  test("rejects a stale publishing revision after an immutable revision append", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraft(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: definition({
          originalText: "same dare, clarified to mean one game",
        }),
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");
    expect(await db.dareRevision.count({ where: { dareId } })).toBe(2);
    const stale = await createDareConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { kind: "dare_publish" },
        idempotencyKey: "stale-publish",
      },
      deps,
      T0,
    );
    expect(stale).toEqual({ kind: "stale_revision", currentRevision: 2 });
  });

  test("binds an idempotency key to the complete confirmation payload", async () => {
    const dareId = await makeDraft();
    const input = {
      dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { kind: "dare_publish" as const },
      idempotencyKey: "payload-binding",
    };
    const first = await createDareConfirmationIntent(input, deps, T0);
    const conflict = await createDareConfirmationIntent(
      { ...input, payload: { kind: "dare_cancel" } },
      deps,
      T0,
    );
    expect(first.kind).toBe("intent_created");
    expect(conflict).toEqual({ kind: "idempotency_conflict" });
  });

  test("creates one stable confirmation intent under concurrent retries", async () => {
    const dareId = await makeDraft();
    const input = {
      dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { kind: "dare_publish" } as const,
      idempotencyKey: "concurrent-publish-intent",
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

describe("Dare published lifecycle", () => {
  test("challenger cancellation during acceptance closes the Dare", async () => {
    const dareId = await makeDraft();
    const publishIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "publish",
      key: "publish-cancel",
    });
    await consume(publishIntent, CHALLENGER);
    const cancelIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "cancel",
      key: "cancel-1",
    });
    const cancelled = await consume(cancelIntent, CHALLENGER);
    expect(cancelled.kind).toBe("cancelled");
  });
});

describe("Dare partial settlement", () => {
  test("preserves an earlier committed summary when a later contract fails", async () => {
    const firstDareId = await makeDraft({});
    const secondDareId = await makeDraft({});
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
    const firstDare = await db.dare.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.dare.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).toBe("achieved");
    expect(firstDare.calloutRefreshPending).toBe(true);
    expect(secondDare.dareState).toBe("active");
    await expect(settleDaresForMatch(match, db)).resolves.toMatchObject([
      { dareId: secondDareId, resolution: "achieved", value: true },
    ]);
  });

  test("preserves deadline summaries when a later settlement fails", async () => {
    const firstDareId = await makeDraft({});
    const secondDareId = await makeDraft({});
    await activate(firstDareId, "deadline-partial-first");
    await activate(secondDareId, "deadline-partial-second");
    await db.dare.updateMany({
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
    const firstDare = await db.dare.findUniqueOrThrow({
      where: { id: firstDareId },
    });
    const secondDare = await db.dare.findUniqueOrThrow({
      where: { id: secondDareId },
    });
    expect(firstDare.dareState).not.toBe("active");
    expect(secondDare.dareState).toBe("active");
  });

  test("activates exactly once when every target accepts concurrently", async () => {
    const dareId = await makeDraft({
      queryText: SHARED_WIN_SQL,
      targets: [TARGET_BINDING, SECOND_TARGET_BINDING],
    });
    await publish(dareId, "concurrent-acceptance");
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
    const dare = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
      include: { targets: true },
    });
    expect(dare.dareState).toBe("active");
    expect(dare.targets.every((target) => target.acceptedAt !== null)).toBe(
      true,
    );
  });
});

describe("Dare evidence and settlement", () => {
  test("captures and records one proof under concurrent match replay", async () => {
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
    expect(await db.dareEvidence.count({ where: { dareId } })).toBe(1);
    const target = await db.dareTarget.findFirstOrThrow({
      where: { dareId, targetKey: "T1" },
    });
    expect(target.acceptedAt).not.toBeNull();
    // The settling transaction names the match, so a resumed settlement can
    // still attest this Dare after its in-memory summary is gone.
    expect(
      await db.dare.findUniqueOrThrow({
        where: { id: dareId },
        select: { settledMatchId: true },
      }),
    ).toEqual({ settledMatchId: match.metadata.matchId });
  });

  test("serializes concurrent evidence and settles unsuccessfully at the bound", async () => {
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
    expect(await db.dareEvidence.count({ where: { dareId } })).toBe(2);
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
  });

  test("voids a contract whose result stays unknowable", async () => {
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
    const dare = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(dare.voidReason).toBe("missing_evidence");
    // Resolved by the deadline, not by any match.
    expect(dare.settledMatchId).toBeNull();
  });

  test("voids a stored contract that no longer parses as invalid_contract", async () => {
    const dareId = await makeDraft();
    await activate(dareId, "invalid-contract");
    await db.dare.update({
      where: { id: dareId },
      data: { contractJson: JSON.stringify({ version: 2 }) },
    });

    await expect(
      settleDaresForMatch(
        matchAt(RiotMatchIdSchema.parse("NA1_9100000010")),
        db,
      ),
    ).resolves.toMatchObject([{ dareId, resolution: "voided", value: null }]);
    const dare = await db.dare.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(dare.voidReason).toBe("invalid_contract");
  });
});
