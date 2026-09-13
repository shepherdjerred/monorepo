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
  ScoutMatchProcessingV2InputSchema,
  scoutLakeProjectionV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutMatchProcessingV2ResultCodec,
  scoutNotificationV2InputCodec,
  scoutNotificationV2ResultCodec,
  scoutPipelineReconciliationV2InputCodec,
  scoutPostMatchDiscoveryV2InputCodec,
  scoutPrematchDiscoveryV2InputCodec,
  scoutPrematchGameV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
} from "./workflow-contracts-v2.ts";
import { ScoutMatchPipelineStateV2ResultSchema } from "./activity-contracts-v2.ts";

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
): void {
  const envelope = codec.serialize(input);
  expect(envelope.kind).toBe(codec.kind);
  expect(envelope.version).toBe(SCOUT_V2_CONTRACT_VERSION);
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
    } as const;
    expect(
      scoutNotificationV2ResultCodec.parse(
        scoutNotificationV2ResultCodec.serialize(result),
      ),
    ).toEqual(result);
  });
});

describe("V2 resume-point read", () => {
  test("reports an unstarted match as absent rather than as an empty one", () => {
    // "Nothing recorded" and "recorded with no receipts" are different
    // answers, and a resuming workflow acts differently on each.
    expect(
      ScoutMatchPipelineStateV2ResultSchema.parse({ kind: "absent" }),
    ).toEqual({ kind: "absent" });
  });

  test("spans observation, receipts, intents and tracked accounts", () => {
    const state = {
      kind: "present",
      state: {
        riotMatchId,
        owner: { kind: "temporal-v2" },
        policy: "FULL",
        promoted: false,
        receiptKinds: [ReceiptKindSchema.parse("lake-staging-match")],
        intents: [{ intentKey, state: { kind: "ready" }, attemptCount: 0 }],
        trackedAccounts: { total: 3, cursorAdvanced: 1 },
      },
    } as const;
    expect(ScoutMatchPipelineStateV2ResultSchema.parse(state)).toEqual(state);
  });

  test("refuses a batch id the workflow id builder could not carry", () => {
    expect(() => RecoveryBatchIdSchema.parse("")).toThrow();
  });
});
