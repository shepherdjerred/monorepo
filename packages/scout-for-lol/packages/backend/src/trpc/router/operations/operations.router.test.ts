import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
} from "@scout-for-lol/temporal";
import {
  OperationsIntentPayloadSchema,
  type OperationsIntentPayload,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { upsertIntent } from "#src/database/durable/intent-repository.ts";
import { observeMatch } from "#src/database/durable/observation-repository.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  recordWorkflowStartAccepted,
  requestWorkflowStart,
} from "#src/database/durable/workflow-start-repository.ts";
import { SCOUT_OPERATOR_IDS } from "#src/operations/operator-allowlist.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testAccountId, testChannelId } from "#src/testing/test-ids.ts";

/**
 * The operations surface is the one place in this backend where a caller can
 * mark an undelivered message delivered, suppress a notification, or re-drive
 * the pipeline. So the properties under test here are the ones that decide
 * whether that power stays where it belongs:
 *
 * - the allowlist is what denies, and the feature flag is not — a stranger is
 *   refused with the flag fully ON;
 * - a confirmation acts exactly once, and re-confirming replays the stored
 *   outcome instead of acting again;
 * - a Workflow start is durably REQUESTED after the claim commits, never
 *   started inside the transaction that claimed it.
 *
 * The harness installs module mocks, so it must run before anything imports the
 * router (see its docblock).
 */

const [FIRST_OPERATOR] = SCOUT_OPERATOR_IDS;
if (FIRST_OPERATOR === undefined) {
  // An empty allowlist would make every assertion below vacuous rather than
  // failing, so it is refused here instead.
  throw new Error("The operator allowlist is empty; these tests prove nothing");
}
const OPERATOR = FIRST_OPERATOR;
const STRANGER = testAccountId("920000001");
const CHANNEL = testChannelId("420003");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5312279829");

const trpc = await createOfflineTrpcHarness("operations-router-test");
const db = trpc.prisma;

function caller(discordId: string = OPERATOR) {
  return trpc.authedCaller(discordId);
}

function instant(offsetMs: number) {
  return IsoInstantSchema.parse(new Date(Date.now() + offsetMs).toISOString());
}

function intentRecord(args: {
  key: string;
  deadlineOffsetMs: number;
  state: MatchNotificationIntentRecord["intent"]["state"];
  attemptCount: number;
  kind?: MatchNotificationIntentRecord["intent"]["kind"];
}): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: {
      key: NotificationIntentKeySchema.parse(args.key),
      kind: args.kind ?? "postmatch",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: CHANNEL },
      freshnessDeadline: instant(args.deadlineOffsetMs),
      createdAt: instant(-60_000),
      attemptCount: args.attemptCount,
      state: args.state,
    },
  };
}

async function seedIntent(
  record: MatchNotificationIntentRecord,
): Promise<string> {
  const result = await upsertIntent(db, record);
  expect(result.outcome).toBe("applied");
  return record.intent.key;
}

async function prepare(payload: OperationsIntentPayload): Promise<string> {
  const prepared = await caller().operations.prepare({ payload });
  return prepared.intentId;
}

async function readStoredResult(intentId: string): Promise<unknown> {
  const row = await db.confirmationIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  expect(row.consumedAt).not.toBeNull();
  return row.resultJson === null ? null : JSON.parse(row.resultJson);
}

type OperationsQueuesRead = Awaited<
  ReturnType<ReturnType<typeof caller>["operations"]["queues"]>
>;

/**
 * Walk one queue two rows at a time until the read reports no more, returning
 * the keys in the order the pages handed them back.
 *
 * `pageBudget` bounds the walk rather than driving it: paging that never
 * reports the last page is itself the failure, and an unbounded loop would
 * hang instead of failing. One page per seeded row is more than enough at two
 * per page.
 */
async function pageThroughQueue(
  queue: "stalledNotifications" | "unacceptedWorkflowStarts",
  pageBudget: number,
  keysOf: (queues: OperationsQueuesRead) => readonly string[],
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  let budget = pageBudget;
  while (budget > 0) {
    budget -= 1;
    const resume = cursor;
    const queues = await caller().operations.queues({
      limit: 2,
      ...(resume === null ? {} : { after: { [queue]: resume } }),
    });
    seen.push(...keysOf(queues));
    cursor = queues.pages[queue].cursor;
    if (!queues.pages[queue].hasMore) {
      // The last page carries no cursor: there is nothing to resume from.
      expect(cursor).toBeNull();
      break;
    }
    expect(cursor).not.toBeNull();
  }
  return seen;
}

const RECONCILE_WORKFLOW_ID = scoutPipelineReconciliationV2WorkflowId(
  configuration.environment,
  "operator",
);

/** The exact start the operator's reconcile derives, as a durable request. */
function reconcileRequest() {
  return {
    requestedWorkflowId: RECONCILE_WORKFLOW_ID,
    workflowType: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
    requestedBy: null,
    requestSource: "operations:reconcile-pipeline",
    inputPayload: {
      kind: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
      version: 1,
      data: { stage: configuration.environment, trigger: "operator" },
    },
    requestedAt: instant(-120_000),
  };
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});

beforeEach(async () => {
  await db.confirmationIntent.deleteMany();
  await db.auditLog.deleteMany();
  await db.matchNotificationIntent.deleteMany();
  await db.matchObservation.deleteMany();
  await db.scoutWorkflowStart.deleteMany();

  resetFlagOverrides("scout_operations_console_enabled");
  // Deliberately global rather than targeted at the operator: every denial in
  // this file must be the allowlist's doing, never the flag's.
  addFlagOverride("scout_operations_console_enabled", true, {});
});

afterAll(async () => {
  resetFlagOverrides("scout_operations_console_enabled");
  await shutdownFeatureFlags();
  await db.$disconnect();
});

describe("operations authorization", () => {
  test("a non-allowlisted caller is refused with the flag fully enabled", async () => {
    // If the allowlist check is removed, this caller reaches `prepare` and the
    // assertion fails — the flag is on, so nothing else can be denying here.
    await expect(
      caller(STRANGER).operations.prepare({
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("every operations procedure denies a non-allowlisted caller", async () => {
    const stranger = caller(STRANGER);
    const attempts = [
      stranger.operations.availability(),
      stranger.operations.queues({}),
      stranger.operations.matchPipeline({ matchId: MATCH_ID }),
      stranger.operations.intentStatus({ intentId: crypto.randomUUID() }),
      stranger.operations.confirm({ intentId: crypto.randomUUID() }),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("an operator is refused when the console flag is off", async () => {
    // The flag can only ever REMOVE the surface, so an operator meeting a
    // disabled console is hidden from rather than forbidden.
    resetFlagOverrides("scout_operations_console_enabled");
    await expect(
      caller().operations.prepare({
        payload: { kind: "ops_reconcile_pipeline", version: 1 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a caller off the allowlist cannot confirm an operator's intent", async () => {
    const intentId = await prepare({
      kind: "ops_reconcile_pipeline",
      version: 1,
    });
    await expect(
      trpc
        .authedCaller(testAccountId("920000009"))
        .operations.confirm({ intentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an operator probing an intent that is not theirs sees an absence", async () => {
    // Reported as absent rather than forbidden: an intent id is a handle to a
    // pipeline action, and probing must not confirm that one exists.
    await expect(
      caller().operations.confirm({ intentId: crypto.randomUUID() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Operations confirmation not found.",
    });
  });
});

describe("operations confirmation is single-use", () => {
  test("resolving an unknown delivery acts once and then replays", async () => {
    const nonce = NotificationAttemptNonceSchema.parse("run-77:attempt-2");
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420003",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 1,
        state: {
          kind: "unknown-delivery",
          attemptNonce: nonce,
          observedAt: instant(-30_000),
        },
      }),
    );
    const intentId = await prepare({
      kind: "ops_resolve_unknown_delivery",
      version: 1,
      intentKey: NotificationIntentKeySchema.parse(key),
      answer: { outcome: "not-delivered", attemptNonce: nonce },
    });

    const first = await caller().operations.confirm({ intentId });

    expect(first).toEqual({
      kind: "executed",
      outcome: {
        kind: "delivery-resolved",
        intentKey: key,
        // Read off the state the machine produced, not from the answer.
        intentState: "ready",
      },
      dispatch: null,
    });
    const row = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: key },
    });
    expect(row.state).toBe("ready");
    // `confirmed-unsent` releases the intent without resetting the attempt it
    // already spent.
    expect(row.attemptCount).toBe(1);

    const second = await caller().operations.confirm({ intentId });

    expect(second).toEqual({
      kind: "already_consumed",
      result: {
        kind: "delivery-resolved",
        intentKey: key,
        intentState: "ready",
      },
    });
    // The replay did not move the machine a second time.
    const afterReplay = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: key },
    });
    expect(afterReplay).toMatchObject({ state: "ready", attemptCount: 1 });
    expect(await db.auditLog.count()).toBe(1);
  });

  test("two concurrent confirmations of one intent produce one effect", async () => {
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420004",
        deadlineOffsetMs: -60_000,
        attemptCount: 0,
        state: { kind: "ready" },
      }),
    );
    const intentId = await prepare({
      kind: "ops_suppress_stale_notification",
      version: 1,
      intentKey: NotificationIntentKeySchema.parse(key),
      note: "Two days stale after the gateway outage.",
    });

    const [a, b] = await Promise.all([
      caller().operations.confirm({ intentId }),
      caller().operations.confirm({ intentId }),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["already_consumed", "executed"]);
    const row = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: key },
    });
    expect(row).toMatchObject({
      state: "suppressed",
      suppressedReason: "stale",
    });
    // One claim, one audit row — the loser of the race did nothing.
    expect(await db.auditLog.count()).toBe(1);
  });
});

describe("operations report what the machine actually did", () => {
  test("suppressing an intent that is not yet stale is refused, not faked", async () => {
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420005",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 0,
        state: { kind: "ready" },
      }),
    );
    const intentId = await prepare({
      kind: "ops_suppress_stale_notification",
      version: 1,
      intentKey: NotificationIntentKeySchema.parse(key),
      note: "Trying to suppress a live intent.",
    });

    const result = await caller().operations.confirm({ intentId });

    expect(result).toEqual({
      kind: "executed",
      outcome: { kind: "machine-refused", reason: "not-stale" },
      dispatch: null,
    });
    const row = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: key },
    });
    expect(row.state).toBe("ready");
    // A refusal still spent a single-use authorization, so it is still audited.
    expect(await db.auditLog.count()).toBe(1);
  });

  test("an answer naming a stale attempt is refused as a stale operator view", async () => {
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420006",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 2,
        state: {
          kind: "unknown-delivery",
          attemptNonce:
            NotificationAttemptNonceSchema.parse("run-99:attempt-3"),
          observedAt: instant(-30_000),
        },
      }),
    );
    const intentId = await prepare({
      kind: "ops_resolve_unknown_delivery",
      version: 1,
      intentKey: NotificationIntentKeySchema.parse(key),
      answer: {
        outcome: "not-delivered",
        attemptNonce: NotificationAttemptNonceSchema.parse("run-77:attempt-2"),
      },
    });

    const result = await caller().operations.confirm({ intentId });

    expect(result).toEqual({
      kind: "executed",
      outcome: { kind: "machine-refused", reason: "stale-operator-view" },
      dispatch: null,
    });
    const unmoved = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: key },
    });
    expect(unmoved.state).toBe("unknown-delivery");
  });

  test("repairing a match this pipeline has never seen is a not-found", async () => {
    const intentId = await prepare({
      kind: "ops_repair_projection",
      version: 1,
      riotMatchId: MATCH_ID,
    });

    const result = await caller().operations.confirm({ intentId });

    expect(result).toEqual({
      kind: "executed",
      outcome: {
        kind: "target-not-found",
        target: "match",
        id: MATCH_ID,
      },
      dispatch: null,
    });
    // Nothing was authorized, so nothing was requested.
    expect(await db.scoutWorkflowStart.count()).toBe(0);
  });
});

describe("workflow starts travel as post-commit durable requests", () => {
  test("confirming a reconcile records the request and starts nothing inline", async () => {
    const intentId = await prepare({
      kind: "ops_reconcile_pipeline",
      version: 1,
    });

    const result = await caller().operations.confirm({ intentId });

    // The stored outcome says the request was AUTHORIZED. At the moment it was
    // written nothing had started, and a replay must not claim otherwise.
    expect(result).toMatchObject({
      kind: "executed",
      outcome: { kind: "start-authorized", workflow: "reconcile-pipeline" },
      dispatch: {
        outcome: "unavailable",
        requestedWorkflowId: RECONCILE_WORKFLOW_ID,
      },
    });

    const start = await db.scoutWorkflowStart.findFirstOrThrow({
      where: { requestedWorkflowId: RECONCILE_WORKFLOW_ID },
    });
    // The answer names the request it recorded, by the request's own key.
    if (result.kind !== "executed" || result.dispatch === null) {
      throw new Error("expected an executed result carrying a dispatch");
    }
    expect(result.dispatch.requestId).toBe(start.requestId);
    expect(start).toMatchObject({
      workflowType: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
      requestSource: "operations:reconcile-pipeline",
      requestedBy: OPERATOR,
      // No Temporal connection in this harness, so the request is durable
      // evidence of an intent to start and nothing more.
      acceptedAt: null,
      runId: null,
    });
    expect(JSON.parse(start.inputPayload)).toEqual({
      kind: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
      version: 1,
      data: { stage: configuration.environment, trigger: "operator" },
    });
    expect(await readStoredResult(intentId)).toEqual({
      kind: "start-authorized",
      workflow: "reconcile-pipeline",
    });
  });

  test("a conflicting durable request fails loudly and leaves the claim committed", async () => {
    // A start already claims this Workflow id with a different input. The
    // dispatch must refuse rather than adopt it.
    const seeded = await requestWorkflowStart(db, {
      requestedWorkflowId: RECONCILE_WORKFLOW_ID,
      workflowType: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
      requestedBy: null,
      requestSource: "test:pre-existing",
      inputPayload: {
        kind: SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
        version: 1,
        data: { stage: configuration.environment, trigger: "schedule" },
      },
      requestedAt: instant(-120_000),
    });
    expect(seeded.outcome).toBe("applied");

    const intentId = await prepare({
      kind: "ops_reconcile_pipeline",
      version: 1,
    });

    await expect(caller().operations.confirm({ intentId })).rejects.toThrow(
      /already requested with a different input/u,
    );

    // The proof that the start is dispatched AFTER the claim's transaction
    // rather than inside it: the dispatch threw, and the claim still committed
    // with its stored outcome. An inline start would have rolled both back.
    expect(await readStoredResult(intentId)).toEqual({
      kind: "start-authorized",
      workflow: "reconcile-pipeline",
    });
    expect(await db.auditLog.count()).toBe(1);
    // The conflicting row was left exactly as it was.
    expect(await db.scoutWorkflowStart.count()).toBe(1);
    const untouched = await db.scoutWorkflowStart.findFirstOrThrow({
      where: { requestedWorkflowId: RECONCILE_WORKFLOW_ID },
    });
    expect(untouched.requestSource).toBe("test:pre-existing");
  });

  test("a request while the previous one is in flight adopts it rather than adding a second", async () => {
    const seeded = await requestWorkflowStart(db, reconcileRequest());
    expect(seeded.outcome).toBe("applied");
    if (seeded.outcome !== "applied") {
      throw new Error("unreachable");
    }

    const intentId = await prepare({
      kind: "ops_reconcile_pipeline",
      version: 1,
    });

    const result = await caller().operations.confirm({ intentId });

    expect(result).toMatchObject({
      kind: "executed",
      dispatch: {
        outcome: "unavailable",
        requestId: seeded.record.requestId,
        requestedWorkflowId: RECONCILE_WORKFLOW_ID,
      },
    });
    expect(await db.scoutWorkflowStart.count()).toBe(1);
  });

  test("a request after the previous one was accepted is a new request, not a repeat refusal", async () => {
    // Before SJ-205 the durable record held one request per workflow id, so a
    // second operator reconcile was answered with the first acceptance and
    // nothing was started. Now the accepted request is terminal and the
    // second is recorded on its own key, ready for Temporal.
    const seeded = await requestWorkflowStart(db, reconcileRequest());
    if (seeded.outcome !== "applied") {
      throw new Error("unreachable");
    }
    const acceptedAt = instant(-119_000);
    const accepted = await recordWorkflowStartAccepted(db, {
      requestId: seeded.record.requestId,
      acceptedAt,
      runId: null,
    });
    expect(accepted).toEqual({ outcome: "applied" });

    const intentId = await prepare({
      kind: "ops_reconcile_pipeline",
      version: 1,
    });

    const result = await caller().operations.confirm({ intentId });

    expect(result).toMatchObject({
      kind: "executed",
      dispatch: {
        outcome: "unavailable",
        requestedWorkflowId: RECONCILE_WORKFLOW_ID,
      },
    });
    if (result.kind !== "executed" || result.dispatch === null) {
      throw new Error("expected an executed result carrying a dispatch");
    }
    expect(result.dispatch.requestId).not.toBe(seeded.record.requestId);

    const rows = await db.scoutWorkflowStart.findMany({
      where: { requestedWorkflowId: RECONCILE_WORKFLOW_ID },
      orderBy: { requestedAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    // The first acceptance is untouched evidence; the second is unaccepted
    // because this harness has no Temporal to accept it.
    expect(rows[0]).toMatchObject({
      requestId: seeded.record.requestId,
      acceptedAt: new Date(acceptedAt),
    });
    expect(rows[1]).toMatchObject({
      requestId: result.dispatch.requestId,
      requestedBy: OPERATOR,
      acceptedAt: null,
    });
  });
});

describe("operations reads", () => {
  test("the queue view surfaces unknown deliveries the sweep refuses to drive", async () => {
    const nonce = NotificationAttemptNonceSchema.parse("run-55:attempt-1");
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420007",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 1,
        state: {
          kind: "unknown-delivery",
          attemptNonce: nonce,
          observedAt: instant(-30_000),
        },
      }),
    );

    const queues = await caller().operations.queues({});

    expect(queues.unknownDeliveries).toEqual([
      {
        intentKey: key,
        matchId: MATCH_ID,
        attemptCount: 1,
        attemptNonce: nonce,
        state: "unknown-delivery",
      },
    ]);
    // The same intent must NOT appear as stalled: nothing may start a child on
    // it, which is exactly why it has its own queue.
    expect(queues.stalledNotifications).toEqual([]);
  });

  test("the queue view keeps the prematch intents the sweep stopped driving", async () => {
    // The counterpart of the sweep's exclusion. A prematch intent whose match
    // carries an observation announces a game that has already ended, so the
    // reconciliation sweep leaves it alone forever — which makes this queue the
    // only place a person can find out it is sitting there. Hiding it here too
    // would turn a visible stranded row into an invisible one.
    const key = await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420010",
        kind: "prematch",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 0,
        state: { kind: "pending" },
      }),
    );
    expect(
      await observeMatch(db, {
        matchId: MATCH_ID,
        platformRoute: platformRouteOf(MATCH_ID),
        policy: "FULL",
        owner: { kind: "legacy-v1" },
        promotion: null,
        gameCreatedAt: instant(-90 * 60_000),
        observedAt: instant(-30_000),
        deliveryMode: "live",
        artifacts: { match: null, timeline: null },
      }),
    ).toEqual({ outcome: "applied" });

    const queues = await caller().operations.queues({});

    expect(queues.stalledNotifications.map((row) => row.intentKey)).toEqual([
      key,
    ]);
  });

  test("a queued unknown delivery is sufficient to resolve through this API alone", async () => {
    // The regression guard for the whole read surface, and the reason it asserts
    // an ACTION rather than a field list: a queue that lists work an operator
    // then cannot perform without reaching into the database is a queue that has
    // silently dropped evidence it held. Everything below is built from the
    // queue item, so a field the read stops returning breaks this test rather
    // than quietly moving the work off-API.
    await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420008",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 3,
        state: {
          kind: "unknown-delivery",
          attemptNonce:
            NotificationAttemptNonceSchema.parse("run-91:attempt-3"),
          observedAt: instant(-45_000),
        },
      }),
    );

    const queues = await caller().operations.queues({});
    const [queued] = queues.unknownDeliveries;
    if (queued === undefined) {
      throw new Error("the seeded unknown delivery was not queued");
    }

    // Constructed ONLY from the queue item — no test-local nonce, no second
    // read. If the payload cannot be assembled from what the queue returned,
    // the parse fails here.
    const payload = OperationsIntentPayloadSchema.parse({
      kind: "ops_resolve_unknown_delivery",
      version: 1,
      intentKey: queued.intentKey,
      answer: { outcome: "not-delivered", attemptNonce: queued.attemptNonce },
    });

    // Parsing is not enough: a well-formed payload naming the WRONG attempt
    // would still be refused as `stale-operator-view`, so the assertion runs it
    // through the machine and requires the intent to actually move.
    const intentId = await prepare(payload);
    const result = await caller().operations.confirm({ intentId });

    expect(result).toEqual({
      kind: "executed",
      outcome: {
        kind: "delivery-resolved",
        intentKey: queued.intentKey,
        intentState: "ready",
      },
      dispatch: null,
    });
    const resolved = await db.matchNotificationIntent.findUniqueOrThrow({
      where: { intentKey: queued.intentKey },
    });
    expect(resolved.state).toBe("ready");
  });

  test("a stalled notification carries the state and deadline of its row", async () => {
    // A bare key cannot tell the console which actions can succeed: `sending`
    // cannot be re-driven and a still-fresh intent cannot be suppressed, so the
    // row has to prove both rather than the UI assuming a query it does not own.
    const deadlineOffsetMs = 90 * 60_000;
    const seeded = intentRecord({
      key: "notification:NA1_5312279829:channel:420010",
      deadlineOffsetMs,
      attemptCount: 2,
      state: { kind: "ready" },
    });
    await seedIntent(seeded);

    const queues = await caller().operations.queues({});

    expect(queues.stalledNotifications).toEqual([
      {
        intentKey: seeded.intent.key,
        matchId: MATCH_ID,
        state: "ready",
        freshnessDeadline: seeded.intent.freshnessDeadline,
        attemptCount: 2,
      },
    ]);
  });

  test("each drivable state reaches the queue as itself", async () => {
    const pending = intentRecord({
      key: "notification:NA1_5312279829:channel:420011",
      deadlineOffsetMs: 60 * 60_000,
      attemptCount: 0,
      state: { kind: "pending" },
    });
    const sending = intentRecord({
      key: "notification:NA1_5312279829:channel:420012",
      deadlineOffsetMs: 120 * 60_000,
      attemptCount: 1,
      state: {
        kind: "sending",
        attemptNonce: NotificationAttemptNonceSchema.parse("run-12:attempt-1"),
        startedAt: instant(-10_000),
      },
    });
    await seedIntent(pending);
    await seedIntent(sending);

    const queues = await caller().operations.queues({});

    expect(
      queues.stalledNotifications.map((row) => [row.intentKey, row.state]),
    ).toEqual([
      [pending.intent.key, "pending"],
      [sending.intent.key, "sending"],
    ]);
  });

  test("a queue seeded past the cap pages completely through the cursor", async () => {
    // Deadlines are distinct and ascending, so the page order is the read's
    // order and a skipped row would show up as a missing key rather than as a
    // reordering.
    const seeded = await Promise.all(
      Array.from({ length: 5 }, async (_unused, index) => {
        const record = intentRecord({
          key: `notification:NA1_5312279829:channel:4201${(20 + index).toString()}`,
          deadlineOffsetMs: (index + 1) * 60_000,
          attemptCount: 0,
          state: { kind: "ready" },
        });
        await seedIntent(record);
        return record.intent.key;
      }),
    );

    const seen = await pageThroughQueue(
      "stalledNotifications",
      seeded.length,
      (queues) => queues.stalledNotifications.map((row) => row.intentKey),
    );

    // Every seeded row was reached exactly once, in the read's own order.
    expect(seen).toEqual(seeded);
  });

  test("a queue inside the cap reports no more and no cursor", async () => {
    await seedIntent(
      intentRecord({
        key: "notification:NA1_5312279829:channel:420030",
        deadlineOffsetMs: 60 * 60_000,
        attemptCount: 0,
        state: { kind: "ready" },
      }),
    );

    const queues = await caller().operations.queues({ limit: 50 });

    expect(queues.pages.stalledNotifications).toEqual({
      hasMore: false,
      cursor: null,
    });
    // An empty queue is equally unambiguous.
    expect(queues.pages.unknownDeliveries).toEqual({
      hasMore: false,
      cursor: null,
    });
  });

  test("a malformed cursor is refused rather than silently restarting", async () => {
    await expect(
      caller().operations.queues({
        after: { stalledNotifications: "not-a-cursor" },
      }),
    ).rejects.toThrow();
  });

  test("a match with no observation reads as not-found", async () => {
    expect(
      await caller().operations.matchPipeline({ matchId: MATCH_ID }),
    ).toEqual({ kind: "not-found" });
  });
});

describe("the workflow-start queue pages by request key", () => {
  test("unaccepted starts sharing one millisecond page completely across the boundary", async () => {
    // Five requests recorded at the SAME instant, so the read can only order
    // them by its tie-break — the request key. The cursor must carry that key:
    // a workflow id in its place would be compared against request keys on the
    // next page and skip every row still sharing the boundary millisecond.
    const requestedAt = instant(-60_000);
    const seeded = await Promise.all(
      Array.from({ length: 5 }, async (_unused, index) => {
        const matchId = RiotMatchIdSchema.parse(
          `NA1_53122798${(30 + index).toString()}`,
        );
        const requested = await requestWorkflowStart(db, {
          requestedWorkflowId: scoutLakeProjectionV2WorkflowId(
            configuration.environment,
            matchId,
          ),
          workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
          requestedBy: null,
          requestSource: "test:shared-millisecond",
          inputPayload: {
            kind: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
            version: 1,
            data: { stage: configuration.environment, riotMatchId: matchId },
          },
          requestedAt,
        });
        if (requested.outcome !== "applied") {
          throw new Error(`seed ${matchId} was not recorded`);
        }
        return requested.record.requestId;
      }),
    );

    const seen = await pageThroughQueue(
      "unacceptedWorkflowStarts",
      seeded.length,
      (queues) => queues.unacceptedWorkflowStarts.map((row) => row.requestId),
    );

    // Every seeded request reached exactly once, in the read's own tie-break
    // order (request key ascending within the shared instant).
    expect(seen).toEqual([...seeded].sort((a, b) => a.localeCompare(b)));
  });

  test("a workflow-start cursor carrying a workflow id instead of a request key is refused", async () => {
    await expect(
      caller().operations.queues({
        after: {
          unacceptedWorkflowStarts: `${instant(-60_000)}|${RECONCILE_WORKFLOW_ID}`,
        },
      }),
    ).rejects.toThrow();
  });
});
