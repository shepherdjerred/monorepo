import { describe, expect, test } from "vitest";
import type { z } from "zod";
import type { VersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  IsoInstantSchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  SCOUT_V2_CONTRACT_VERSION,
  ScoutDurableCommitV2Schema,
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  ScoutRecoveryBatchIdSchema,
} from "./contracts-v2.ts";
import {
  SCOUT_CLIENT_MATCH_DISPATCH_V2_INPUT_VERSION,
  SCOUT_NOTIFICATION_V2_RESULT_VERSION,
  ScoutMatchProcessingV2InputSchema,
  ScoutRecoveryBatchV2ResultSchema,
  scoutClientMatchDispatchV2InputCodec,
  scoutRecoveryBatchV2ResultCodec,
  scoutLakeProjectionV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutMatchProcessingV2ResultCodec,
  SCOUT_MATCH_PROCESSING_V2_RESULT_VERSION,
  scoutNotificationV2InputCodec,
  scoutNotificationV2ResultCodec,
  scoutPipelineReconciliationV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPrematchDiscoveryV2InputCodec,
  scoutPrematchGameV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
} from "./workflow-contracts-v2.ts";
import {
  ScoutMatchPipelineStateV2ResultSchema,
  ScoutRecoveryBatchStateV2ResultSchema,
} from "./activity-contracts-v2.ts";
import {
  SCOUT_V2_REDRIVABLE_WORKFLOW_NAMES,
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
} from "./identifiers.ts";

const riotMatchId = RiotMatchIdSchema.parse("NA1_5312279829");
const intentKey = ScoutNotificationIntentKeySchema.parse(
  "notify:NA1_5312279829:guild:1234567890",
);
const recoveryBatchId = ScoutRecoveryBatchIdSchema.parse("recovery_01");
const gameRef = ScoutPrematchGameRefSchema.parse({
  puuid: "p".repeat(78),
  platform: "NA1",
  gameId: "5312279829",
});

function expectRoundTrip<Kind extends string, Schema extends z.ZodType>(
  codec: VersionedCodec<Kind, Schema>,
  input: z.infer<Schema>,
  expectedVersion = SCOUT_V2_CONTRACT_VERSION,
): void {
  const envelope = codec.serialize(input);
  expect(envelope.kind).toBe(codec.kind);
  expect(envelope.version).toBe(expectedVersion);
  expect(codec.parse(envelope)).toEqual(input);
}

describe("V2 workflow input envelopes", () => {
  test("round-trips every V2 workflow input through its envelope", () => {
    expectRoundTrip(scoutPostMatchDiscoveryV2InputCodec, {
      stage: "prod",
      trigger: "schedule",
    });
    expectRoundTrip(scoutMatchProcessingV2InputCodec, {
      stage: "prod",
      riotMatchId,
    });
    expectRoundTrip(
      scoutClientMatchDispatchV2InputCodec,
      {
        stage: "prod",
        pending: [],
        lateArrivals: [],
        orderingWatermark: null,
      },
      SCOUT_CLIENT_MATCH_DISPATCH_V2_INPUT_VERSION,
    );
    expectRoundTrip(scoutPrematchDiscoveryV2InputCodec, { stage: "beta" });
    expectRoundTrip(scoutPrematchGameV2InputCodec, { stage: "beta", gameRef });
    expectRoundTrip(scoutNotificationV2InputCodec, {
      stage: "prod",
      intentKey,
    });
    expectRoundTrip(scoutLakeProjectionV2InputCodec, {
      stage: "prod",
      riotMatchId,
    });
    expectRoundTrip(scoutRecoveryBatchV2InputCodec, {
      stage: "dev",
      recoveryBatchId,
    });
    expectRoundTrip(scoutPipelineReconciliationV2InputCodec, {
      stage: "prod",
      trigger: "operator",
    });
  });

  test("rejects an envelope from a version it cannot migrate", () => {
    // A worker meeting a payload written by a future build must fail loudly.
    // The alternative — reading it as the current shape — is how a field that
    // changed meaning silently corrupts a match.
    const envelope = scoutMatchProcessingV2InputCodec.serialize({
      stage: "prod",
      riotMatchId,
    });
    expect(() =>
      scoutMatchProcessingV2InputCodec.parse({ ...envelope, version: 2 }),
    ).toThrow(/unknown scout-match-processing-v2-input envelope version 2/u);
  });

  test("refuses an envelope carrying another contract's payload", () => {
    const envelope = scoutLakeProjectionV2InputCodec.serialize({
      stage: "prod",
      riotMatchId,
    });
    expect(() => scoutMatchProcessingV2InputCodec.parse(envelope)).toThrow();
  });

  test("refuses a bare payload that skipped the envelope", () => {
    expect(() =>
      scoutMatchProcessingV2InputCodec.parse({ stage: "prod", riotMatchId }),
    ).toThrow();
  });

  test("migrates the dispatcher input from before its durable watermark", () => {
    expect(
      scoutClientMatchDispatchV2InputCodec.parse({
        kind: "scout-client-match-dispatch-v2-input",
        version: 1,
        data: { stage: "prod", pending: [] },
      }),
    ).toEqual({
      stage: "prod",
      pending: [],
      lateArrivals: [],
      orderingWatermark: null,
    });
  });
});

describe("V2 workflow inputs carry references, never payloads", () => {
  test("refuses a match input smuggling a Riot payload alongside the id", () => {
    expect(() =>
      ScoutMatchProcessingV2InputSchema.parse({
        stage: "prod",
        riotMatchId,
        // A workflow input is copied into history and kept for the life of the
        // execution; a MatchV5 body here would be stored forever, per match.
        info: { participants: [{ puuid: "p".repeat(78) }] },
      }),
    ).toThrow();
  });

  test("refuses a match id Riot could not have issued", () => {
    expect(() =>
      ScoutMatchProcessingV2InputSchema.parse({
        stage: "prod",
        riotMatchId: "not-a-match-id",
      }),
    ).toThrow();
  });

  test("refuses a game reference holding a spectator snapshot", () => {
    expect(() =>
      ScoutPrematchGameRefSchema.parse({
        puuid: "p".repeat(78),
        platform: "NA1",
        gameId: "5312279829",
        participants: [{ championId: 1 }],
      }),
    ).toThrow();
  });

  test("keeps a game id a digit string so it cannot become a float", () => {
    expect(() =>
      ScoutPrematchGameRefSchema.parse({ ...gameRef, gameId: 5_312_279_829 }),
    ).toThrow();
  });
});

describe("V2 identifiers stay usable as workflow ids", () => {
  test("refuses an intent key outside the replay id character set", () => {
    // The key is interpolated into a workflow id; a key with a space or slash
    // produces an execution `replay:candidate-histories` cannot select.
    expect(() =>
      ScoutNotificationIntentKeySchema.parse("notify NA1/guild"),
    ).toThrow();
    expect(() => ScoutRecoveryBatchIdSchema.parse("recovery batch")).toThrow();
  });

  test("accepts the separators Scout actually mints keys with", () => {
    expect(ScoutNotificationIntentKeySchema.parse("notify:NA1_1.guild-2")).toBe(
      "notify:NA1_1.guild-2",
    );
  });
});

describe("V2 reuse policies", () => {
  test("names exactly the re-drivable families plus singleton starts", () => {
    expect(Object.keys(SCOUT_V2_REUSE_POLICIES).sort()).toEqual(
      [
        ...SCOUT_V2_REDRIVABLE_WORKFLOW_NAMES,
        SCOUT_WORKFLOW_NAMES.clientMatchDispatchV2,
        SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
      ].sort(),
    );
  });

  test("reconciliation may be run again after any close", () => {
    // Repeat operator reconciles are a beta acceptance requirement. Acceptance
    // ends a request's handoff (ScoutWorkflowStart holds one row per request),
    // so nothing durable has to refuse a repeat, and a running sweep is joined
    // by the operator path's USE_EXISTING conflict policy rather than
    // duplicated. The backend's operator start reads this entry — it does not
    // spell its own — so this pin is the one place the term can change.
    expect(
      SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2],
    ).toBe("ALLOW_DUPLICATE");
  });
});

describe("V2 durable commit outcomes", () => {
  test("speaks the repository vocabulary, including adoption", () => {
    for (const outcome of ["applied", "already-applied", "adopted"] as const) {
      expect(ScoutDurableCommitV2Schema.parse({ outcome })).toEqual({
        outcome,
      });
    }
  });

  test("carries the repository's own drift reason for receipts", () => {
    // `receipt-evidence-mismatch` is raised by receipt-repository.ts comparing
    // stored evidence; the pure domain transition compares identity alone and
    // can no longer answer it. A result limited to the domain's answers would
    // be unable to report the drift at all.
    expect(
      ScoutDurableCommitV2Schema.parse({
        outcome: "conflict",
        reason: "receipt-evidence-mismatch",
      }),
    ).toEqual({ outcome: "conflict", reason: "receipt-evidence-mismatch" });
  });

  test("carries persistence reasons no pure transition produces", () => {
    for (const reason of [
      "observation-differs",
      "intent-differs",
      "batch-differs",
      // Omitting this one made the settlement sink's conflict branch
      // unreachable: `durableCommitV2` parses the repository's answer, so a
      // reason missing here threw a ZodError before the branch was read, and
      // the broad handler below it logged that as an ordinary pool failure.
      "settlement-announcement-differs",
      "workflow-adopted-by-another-batch",
    ]) {
      expect(
        ScoutDurableCommitV2Schema.parse({ outcome: "conflict", reason }),
      ).toEqual({ outcome: "conflict", reason });
    }
  });

  test("refuses a conflict without a reason", () => {
    expect(() =>
      ScoutDurableCommitV2Schema.parse({ outcome: "conflict" }),
    ).toThrow();
  });
});

describe("V2 workflow results", () => {
  test("round-trips a match result in the domain's own vocabulary", () => {
    const result = {
      status: "completed",
      riotMatchId,
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      deliveryMode: "live",
      receiptKinds: [ReceiptKindSchema.parse("raw-archive-match")],
      childrenStarted: { notifications: 2, lakeProjections: 1 },
    } as const;
    expect(
      scoutMatchProcessingV2ResultCodec.parse(
        scoutMatchProcessingV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });

  test("lets a notification finish in unknown-delivery", () => {
    // Unobserved delivery is a legitimate terminal result, not a failure: the
    // machine leaves it only through an operator, so the contract has to be
    // able to report it.
    const result = {
      status: "completed",
      intentKey,
      state: {
        kind: "unknown-delivery",
        attemptNonce: NotificationAttemptNonceSchema.parse("run-abc:1"),
        observedAt: IsoInstantSchema.parse("2026-09-11T16:00:00.000Z"),
      },
      attemptCount: 1,
      disposition: { kind: "driven" },
    } as const;
    expect(
      scoutNotificationV2ResultCodec.parse(
        scoutNotificationV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });

  test("lets a notification report that it was held by policy", () => {
    // A held run did nothing to the intent, and its result has to say so
    // rather than present an unattempted send as a completed one.
    const result = {
      status: "no-op",
      intentKey,
      state: { kind: "ready" },
      attemptCount: 0,
      disposition: { kind: "held", policy: "no-external", target: "channel" },
    } as const;
    const envelope = scoutNotificationV2ResultCodec.serialize(result);
    expect(envelope.version).toBe(SCOUT_NOTIFICATION_V2_RESULT_VERSION);
    expect(scoutNotificationV2ResultCodec.parse(envelope)).toEqual(result);
  });

  test("migrates a version-1 notification result as driven", () => {
    // Version-1 results were written by runs with no policy gate, so the
    // only disposition they could have had is the one the migration stamps.
    const migrated = scoutNotificationV2ResultCodec.parse({
      kind: "scout-notification-v2-result",
      version: 1,
      data: {
        status: "completed",
        intentKey,
        state: { kind: "delivered", deliveredAt: "2026-09-11T16:00:00.000Z" },
        attemptCount: 1,
      },
    });
    expect(migrated.disposition).toEqual({ kind: "driven" });
    expect(migrated.state).toEqual({
      kind: "delivered",
      deliveredAt: "2026-09-11T16:00:00.000Z",
    });
  });
});

describe("V2 recovery batch results", () => {
  test("reports the tally a run that drove processing watched", () => {
    const result = {
      status: "completed",
      recoveryBatchId,
      state: { kind: "complete" },
      counts: {
        kind: "observed",
        counts: { discovered: 40, succeeded: 38, suppressed: 1, failed: 1 },
      },
    } as const;
    expect(
      scoutRecoveryBatchV2ResultCodec.parse(
        scoutRecoveryBatchV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });

  test("lets a run resumed past processing complete without a tally", () => {
    // A reconciliation sweep or an operator restart can land on a batch whose
    // row is already `digesting`, `complete` or `abandoned`. Those rows have
    // NULL count columns — `recoveryBatchStateColumns` writes them that way —
    // so this run has no tally and never will. Requiring one here would force
    // an implementation to invent zeros or fail a finished batch.
    const result = {
      status: "completed",
      recoveryBatchId,
      state: { kind: "complete" },
      counts: { kind: "unobserved" },
    } as const;
    expect(
      scoutRecoveryBatchV2ResultCodec.parse(
        scoutRecoveryBatchV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });

  test("lets a run resumed onto an abandoned batch report the reason", () => {
    const result = {
      status: "completed",
      recoveryBatchId,
      state: { kind: "abandoned", reason: "operator-cancelled" },
      counts: { kind: "unobserved" },
    } as const;
    expect(
      scoutRecoveryBatchV2ResultCodec.parse(
        scoutRecoveryBatchV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });

  test("refuses a bare tally that skipped the observation question", () => {
    // Guards the shape itself: counts must say whether they were observed, so
    // the old `counts: RecoveryCounts` form cannot quietly come back.
    expect(() =>
      ScoutRecoveryBatchV2ResultSchema.parse({
        status: "completed",
        recoveryBatchId,
        state: { kind: "complete" },
        counts: { discovered: 0, succeeded: 0, suppressed: 0, failed: 0 },
      }),
    ).toThrow();
  });
});

describe("V2 resume-point read", () => {
  test("surfaces a processing batch's tally, and has none past it", () => {
    // The row holds count columns only while the batch is `processing`, so the
    // state union is the whole truth the read can tell.
    const processing = ScoutRecoveryBatchStateV2ResultSchema.parse({
      kind: "present",
      policy: "normal",
      state: {
        kind: "processing",
        counts: { discovered: 9, succeeded: 4, suppressed: 0, failed: 0 },
      },
    });
    expect(processing).toHaveProperty(["state", "counts", "discovered"], 9);

    const complete = ScoutRecoveryBatchStateV2ResultSchema.parse({
      kind: "present",
      policy: "normal",
      state: { kind: "complete" },
    });
    expect(complete).toEqual({
      kind: "present",
      policy: "normal",
      state: { kind: "complete" },
    });
  });

  test("reports an unstarted match as absent rather than as an empty one", () => {
    // "Nothing recorded" and "recorded with no receipts" are different
    // answers, and a resuming workflow acts differently on each.
    expect(
      ScoutMatchPipelineStateV2ResultSchema.parse({ kind: "absent" }),
    ).toEqual({ kind: "absent" });
  });

  test("reports a terminal marker that predates its observation", () => {
    expect(
      ScoutMatchPipelineStateV2ResultSchema.parse({ kind: "terminal" }),
    ).toEqual({ kind: "terminal" });
  });

  test("spans observation, receipts, intents and tracked accounts", () => {
    const state = {
      kind: "present",
      state: {
        riotMatchId,
        owner: { kind: "temporal-v2" },
        policy: "FULL",
        deliveryMode: "silent-backfill",
        promoted: false,
        receiptKinds: [ReceiptKindSchema.parse("lake-staging-match")],
        intents: [{ intentKey, state: { kind: "ready" }, attemptCount: 0 }],
        trackedAccounts: { total: 3, cursorAdvanced: 1 },
      },
    } as const;
    expect(ScoutMatchPipelineStateV2ResultSchema.parse(state)).toEqual(state);
  });

  test("still parses a match result recorded before deliveryMode existed", () => {
    // The replay hazard the version bump exists for. A version-1 result
    // predates the field, and a codec that advertised version 1 while its
    // schema demanded the field would have failed every historical parse.
    const version1 = {
      kind: "scout-match-processing-v2-result",
      version: 1,
      data: {
        status: "completed",
        riotMatchId,
        owner: { kind: "temporal-v2" },
        policy: "FULL",
        receiptKinds: [ReceiptKindSchema.parse("raw-archive-match")],
        childrenStarted: { notifications: 0, lakeProjections: 0 },
      },
    };

    const parsed = scoutMatchProcessingV2ResultCodec.parse(version1);

    // Migrated, not rejected, and to the mode that run actually operated
    // under: the observation commit recorded `live` unconditionally then.
    expect(parsed.deliveryMode).toBe("live");
    expect(parsed.status).toBe("completed");
  });

  test("serializes new results at version 2", () => {
    const envelope = scoutMatchProcessingV2ResultCodec.serialize({
      status: "completed",
      riotMatchId,
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      deliveryMode: "silent-backfill",
      receiptKinds: [],
      childrenStarted: { notifications: 0, lakeProjections: 0 },
    });

    expect(envelope.version).toBe(SCOUT_MATCH_PROCESSING_V2_RESULT_VERSION);
    expect(SCOUT_MATCH_PROCESSING_V2_RESULT_VERSION).toBe(2);
  });

  test("refuses a batch id the workflow id builder could not carry", () => {
    expect(() => RecoveryBatchIdSchema.parse("")).toThrow();
  });
});
