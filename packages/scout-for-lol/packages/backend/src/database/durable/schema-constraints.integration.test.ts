import { afterAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The durable operational tables are guarded by hand-authored CHECK
 * constraints; this suite proves each one actually rejects the shape it
 * exists to reject, against a real Postgres carrying the deployed
 * migrations (the test-template database is built with `prisma migrate
 * deploy`, so a migration that fails to apply fails here first).
 *
 * Every invalid row below is a copy of a known-good row with exactly one
 * violation, so the asserted constraint name is the only one that can fire.
 */

const { prisma } = createTestDatabase("durable-schema-constraints");

afterAll(async () => {
  await prisma.$disconnect();
});

function insertSql(table: string, values: Record<string, string>): string {
  const columns = Object.keys(values)
    .map((column) => `"${column}"`)
    .join(", ");
  const literals = Object.values(values).join(", ");
  return `INSERT INTO "${table}" (${columns}) VALUES (${literals})`;
}

async function expectRejected(sql: string, constraint: string): Promise<void> {
  await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(constraint);
}

const NOW = "'2026-09-07 10:00:00'";
const DIGEST = `'${"a".repeat(64)}'`;
const PUUID = `'${"p".repeat(78)}'`;
const INTENT_PAYLOAD = `'{"kind":"notification-intent","version":1,"data":{}}'`;
const START_PAYLOAD = `'{"kind":"match-recovery","version":1,"data":{}}'`;

test("the migration created every durable operational table", async () => {
  const rows: unknown = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'MatchObservation', 'MatchTrackedAccount', 'MatchProcessingReceipt',
        'MatchNotificationIntent', 'MatchRecoveryBatch', 'ScoutWorkflowStart',
        'ScoutOperatorAuditEvent'
      ) ORDER BY table_name`,
  );
  const names = z
    .array(z.object({ table_name: z.string() }))
    .parse(rows)
    .map((row) => row.table_name);
  expect(names).toEqual([
    "MatchNotificationIntent",
    "MatchObservation",
    "MatchProcessingReceipt",
    "MatchRecoveryBatch",
    "MatchTrackedAccount",
    "ScoutOperatorAuditEvent",
    "ScoutWorkflowStart",
  ]);
});

describe("MatchObservation constraints", () => {
  const valid: Record<string, string> = {
    riotMatchId: "'NA1_1'",
    platformRoute: "'NA1'",
    processingPolicy: "'ARCHIVE_ONLY'",
    gameCreatedAt: NOW,
    observedAt: NOW,
    updatedAt: NOW,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("MatchObservation", valid));
  });

  test.each([
    [
      "policy vocabulary",
      { ...valid, riotMatchId: "'NA1_2'", processingPolicy: "'PARTIAL'" },
      "MatchObservation_policy_check",
    ],
    [
      "owner vocabulary",
      { ...valid, riotMatchId: "'NA1_3'", pipelineOwner: "'V3'" },
      "MatchObservation_owner_check",
    ],
    [
      "promotion under ARCHIVE_ONLY",
      { ...valid, riotMatchId: "'NA1_4'", promotedAt: NOW },
      "MatchObservation_promotion_check",
    ],
    [
      "platform route vocabulary",
      {
        ...valid,
        riotMatchId: "'XX9_5'",
        platformRoute: "'XX9'",
      },
      "MatchObservation_platform_route_check",
    ],
    [
      "match id platform prefix",
      { ...valid, riotMatchId: "'EUW1_6'" },
      "MatchObservation_match_id_platform_check",
    ],
    [
      "a match id without a numeric game id",
      { ...valid, riotMatchId: "'NA1_'" },
      "MatchObservation_riot_match_id_format_check",
    ],
    [
      "an empty object key",
      {
        ...valid,
        riotMatchId: "'NA1_7'",
        matchObjectKey: "''",
        matchDigest: DIGEST,
      },
      "MatchObservation_object_key_length_check",
    ],
    [
      "unpaired match artifact",
      { ...valid, riotMatchId: "'NA1_8'", matchObjectKey: "'k'" },
      "MatchObservation_match_artifact_check",
    ],
    [
      "unpaired timeline artifact",
      { ...valid, riotMatchId: "'NA1_9'", timelineDigest: DIGEST },
      "MatchObservation_timeline_artifact_check",
    ],
    [
      "match digest format",
      {
        ...valid,
        riotMatchId: "'NA1_10'",
        matchObjectKey: "'k'",
        matchDigest: "'NOTHEX'",
      },
      "MatchObservation_match_digest_format_check",
    ],
    [
      "timeline digest format",
      {
        ...valid,
        riotMatchId: "'NA1_11'",
        timelineObjectKey: "'k'",
        timelineDigest: "'NOTHEX'",
      },
      "MatchObservation_timeline_digest_format_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(insertSql("MatchObservation", values), constraint);
  });
});

describe("MatchTrackedAccount constraints", () => {
  const valid: Record<string, string> = {
    riotMatchId: "'NA1_1'",
    puuid: PUUID,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("MatchTrackedAccount", valid));
  });

  test.each([
    [
      "a malformed riot match id",
      { ...valid, riotMatchId: "'NA1_'" },
      "MatchTrackedAccount_riot_match_id_format_check",
    ],
    [
      "a puuid that is not 78 characters",
      { ...valid, riotMatchId: "'NA1_2'", puuid: `'${"p".repeat(77)}'` },
      "MatchTrackedAccount_puuid_length_check",
    ],
    [
      "a non-positive player id",
      { ...valid, riotMatchId: "'NA1_3'", playerId: "0" },
      "MatchTrackedAccount_ids_positive_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(insertSql("MatchTrackedAccount", values), constraint);
  });
});

describe("MatchProcessingReceipt constraints", () => {
  const valid: Record<string, string> = {
    riotMatchId: "'NA1_1'",
    kind: "'report-posted'",
    version: "1",
    scopeKind: "'global'",
    scopeKey: "'global'",
    recordedAt: NOW,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("MatchProcessingReceipt", valid));
  });

  test.each([
    [
      "a malformed riot match id",
      { ...valid, riotMatchId: "'NA1_'" },
      "MatchProcessingReceipt_riot_match_id_format_check",
    ],
    [
      "a kind outside the kebab-case ReceiptKind shape",
      { ...valid, version: "2", kind: "'Report:Posted'" },
      "MatchProcessingReceipt_kind_shape_check",
    ],
    [
      "a zero version",
      { ...valid, version: "0" },
      "MatchProcessingReceipt_version_check",
    ],
    [
      "an unknown scope kind",
      { ...valid, version: "3", scopeKind: "'server'", scopeKey: "'server'" },
      "MatchProcessingReceipt_scope_kind_check",
    ],
    [
      "a guild scope without a guild id",
      {
        ...valid,
        version: "4",
        scopeKind: "'guild'",
        scopeKey: "'guild:1'",
      },
      "MatchProcessingReceipt_scope_fields_check",
    ],
    [
      "an account scope carrying a guild id",
      {
        ...valid,
        version: "5",
        scopeKind: "'account'",
        scopeAccountId: "42",
        scopeGuildId: "'100000000000000001'",
        scopeKey: "'account:42'",
      },
      "MatchProcessingReceipt_scope_fields_check",
    ],
    [
      "a global scope carrying an account id",
      { ...valid, version: "6", scopeAccountId: "42" },
      "MatchProcessingReceipt_scope_fields_check",
    ],
    [
      "a scope key that disagrees with the scope columns",
      {
        ...valid,
        version: "7",
        scopeKind: "'guild'",
        scopeGuildId: "'100000000000000001'",
        scopeKey: "'guild:456'",
      },
      "MatchProcessingReceipt_scope_key_check",
    ],
    [
      "a guild id that is not a Discord snowflake",
      {
        ...valid,
        version: "8",
        scopeKind: "'guild'",
        scopeGuildId: "'123'",
        scopeKey: "'guild:123'",
      },
      "MatchProcessingReceipt_scope_id_shape_check",
    ],
    [
      "a non-positive account id",
      {
        ...valid,
        version: "9",
        scopeKind: "'account'",
        scopeAccountId: "0",
        scopeKey: "'account:0'",
      },
      "MatchProcessingReceipt_scope_id_shape_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(
      insertSql("MatchProcessingReceipt", values),
      constraint,
    );
  });
});

describe("MatchNotificationIntent constraints", () => {
  const valid: Record<string, string> = {
    intentKey: "'intent-1'",
    riotMatchId: "'NA1_1'",
    targetKind: "'channel'",
    targetId: "'300000000000000001'",
    state: "'pending'",
    attemptCount: "0",
    freshnessDeadline: NOW,
    payload: INTENT_PAYLOAD,
    createdAt: NOW,
    updatedAt: NOW,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("MatchNotificationIntent", valid));
  });

  test.each([
    [
      "an unknown state",
      { ...valid, intentKey: "'i2'", state: "'queued'" },
      "MatchNotificationIntent_state_check",
    ],
    [
      "an unknown target kind",
      { ...valid, intentKey: "'i3'", targetKind: "'webhook'" },
      "MatchNotificationIntent_target_kind_check",
    ],
    [
      "a negative attempt count",
      { ...valid, intentKey: "'i4'", attemptCount: "-1" },
      "MatchNotificationIntent_attempt_count_check",
    ],
    [
      "sending with a zero attempt count",
      {
        ...valid,
        intentKey: "'i5'",
        state: "'sending'",
        attemptNonce: "'n1'",
        sendStartedAt: NOW,
      },
      "MatchNotificationIntent_attempted_states_check",
    ],
    [
      "an attempt nonce outside sending or unknown-delivery",
      { ...valid, intentKey: "'i6'", state: "'ready'", attemptNonce: "'n1'" },
      "MatchNotificationIntent_attempt_nonce_check",
    ],
    [
      "sending without its started-at",
      {
        ...valid,
        intentKey: "'i7'",
        state: "'sending'",
        attemptCount: "1",
        attemptNonce: "'n1'",
      },
      "MatchNotificationIntent_send_started_check",
    ],
    [
      "delivered without its delivered-at",
      { ...valid, intentKey: "'i8'", state: "'delivered'", attemptCount: "1" },
      "MatchNotificationIntent_delivered_at_check",
    ],
    [
      "a message id outside delivered",
      { ...valid, intentKey: "'i9'", messageId: "'400000000000000001'" },
      "MatchNotificationIntent_message_id_check",
    ],
    [
      "suppressed without a reason",
      { ...valid, intentKey: "'i10'", state: "'suppressed'" },
      "MatchNotificationIntent_suppressed_reason_check",
    ],
    [
      "an unknown suppression reason",
      {
        ...valid,
        intentKey: "'i11'",
        state: "'suppressed'",
        suppressedReason: "'bored'",
      },
      "MatchNotificationIntent_suppressed_reason_vocab_check",
    ],
    [
      "unknown-delivery without its observed-at",
      {
        ...valid,
        intentKey: "'i12'",
        state: "'unknown-delivery'",
        attemptCount: "1",
        attemptNonce: "'n1'",
      },
      "MatchNotificationIntent_unknown_observed_check",
    ],
    [
      "a malformed riot match id",
      { ...valid, intentKey: "'i13'", riotMatchId: "'NA1_'" },
      "MatchNotificationIntent_riot_match_id_format_check",
    ],
    [
      "an empty intent key",
      { ...valid, intentKey: "''" },
      "MatchNotificationIntent_key_shape_check",
    ],
    [
      "an empty attempt nonce",
      {
        ...valid,
        intentKey: "'i14'",
        state: "'sending'",
        attemptCount: "1",
        attemptNonce: "''",
        sendStartedAt: NOW,
      },
      "MatchNotificationIntent_key_shape_check",
    ],
    [
      "a target id that is not a Discord snowflake",
      { ...valid, intentKey: "'i15'", targetId: "'abc'" },
      "MatchNotificationIntent_discord_id_shape_check",
    ],
    [
      "a payload envelope of a foreign kind",
      {
        ...valid,
        intentKey: "'i16'",
        payload: `'{"kind":"artifact-descriptor","version":1,"data":{}}'`,
      },
      "MatchNotificationIntent_payload_kind_check",
    ],
    [
      "a failure classification without its reason",
      {
        ...valid,
        intentKey: "'i17'",
        lastFailureClassification: "'retryable'",
      },
      "MatchNotificationIntent_failure_pairing_check",
    ],
    [
      "a failure reason outside its classification's vocabulary",
      {
        ...valid,
        intentKey: "'i18'",
        lastFailureClassification: "'retryable'",
        lastFailureReason: "'dm-disabled'",
      },
      "MatchNotificationIntent_failure_vocab_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(
      insertSql("MatchNotificationIntent", values),
      constraint,
    );
  });
});

describe("MatchRecoveryBatch constraints", () => {
  const valid: Record<string, string> = {
    recoveryBatchId: "'rb-1'",
    policy: "'normal'",
    state: "'planned'",
    createdAt: NOW,
    updatedAt: NOW,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("MatchRecoveryBatch", valid));
  });

  test.each([
    [
      "an unknown policy",
      { ...valid, recoveryBatchId: "'rb-2'", policy: "'yolo'" },
      "MatchRecoveryBatch_policy_check",
    ],
    [
      "an unknown state",
      { ...valid, recoveryBatchId: "'rb-3'", state: "'paused'" },
      "MatchRecoveryBatch_state_check",
    ],
    [
      "cursor columns outside scanning",
      { ...valid, recoveryBatchId: "'rb-4'", pagesScanned: "0" },
      "MatchRecoveryBatch_cursor_presence_check",
    ],
    [
      "a cursor position with zero pages scanned",
      {
        ...valid,
        recoveryBatchId: "'rb-5'",
        state: "'scanning'",
        cursorPosition: "'p1'",
        pagesScanned: "0",
        pageBudget: "5",
      },
      "MatchRecoveryBatch_cursor_position_check",
    ],
    [
      "pages scanned beyond the budget",
      {
        ...valid,
        recoveryBatchId: "'rb-6'",
        state: "'scanning'",
        cursorPosition: "'p1'",
        pagesScanned: "6",
        pageBudget: "5",
      },
      "MatchRecoveryBatch_cursor_bounds_check",
    ],
    [
      "counts outside processing",
      { ...valid, recoveryBatchId: "'rb-7'", discoveredCount: "1" },
      "MatchRecoveryBatch_counts_presence_check",
    ],
    [
      "processed counts beyond discovered",
      {
        ...valid,
        recoveryBatchId: "'rb-8'",
        state: "'processing'",
        discoveredCount: "2",
        succeededCount: "2",
        suppressedCount: "1",
        failedCount: "0",
      },
      "MatchRecoveryBatch_counts_bounds_check",
    ],
    [
      "abandoned without a reason",
      { ...valid, recoveryBatchId: "'rb-9'", state: "'abandoned'" },
      "MatchRecoveryBatch_abandon_reason_check",
    ],
    [
      "an unknown abandon reason",
      {
        ...valid,
        recoveryBatchId: "'rb-10'",
        state: "'abandoned'",
        abandonReason: "'tired'",
      },
      "MatchRecoveryBatch_abandon_reason_vocab_check",
    ],
    [
      "an empty batch id",
      { ...valid, recoveryBatchId: "''" },
      "MatchRecoveryBatch_key_shape_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(insertSql("MatchRecoveryBatch", values), constraint);
  });
});

describe("ScoutWorkflowStart constraints", () => {
  const valid: Record<string, string> = {
    requestedWorkflowId: "'wf-1'",
    workflowType: "'match-recovery'",
    requestSource: "'operator'",
    inputPayload: START_PAYLOAD,
    requestedAt: NOW,
    updatedAt: NOW,
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("ScoutWorkflowStart", valid));
  });

  test.each([
    [
      "a run id without acceptance",
      { ...valid, requestedWorkflowId: "'wf-2'", runId: "'run-1'" },
      "ScoutWorkflowStart_run_id_check",
    ],
    [
      "an empty request source",
      { ...valid, requestedWorkflowId: "'wf-3'", requestSource: "''" },
      "ScoutWorkflowStart_text_shape_check",
    ],
    [
      "a requester that is not a Discord snowflake",
      { ...valid, requestedWorkflowId: "'wf-4'", requestedBy: "'abc'" },
      "ScoutWorkflowStart_text_shape_check",
    ],
    [
      "an input payload whose kind is not the workflow type",
      {
        ...valid,
        requestedWorkflowId: "'wf-5'",
        inputPayload: `'{"kind":"hall-baseline","version":1,"data":{}}'`,
      },
      "ScoutWorkflowStart_input_payload_kind_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(insertSql("ScoutWorkflowStart", values), constraint);
  });
});

describe("ScoutOperatorAuditEvent constraints", () => {
  const valid: Record<string, string> = {
    actorDiscordId: "'200000000000000001'",
    action: "'recovery-policy-released'",
    subjectKind: "'recovery-batch'",
    subjectId: "'rb-1'",
    detail: "'{}'",
  };

  test("accepts a valid row", async () => {
    await prisma.$executeRawUnsafe(insertSql("ScoutOperatorAuditEvent", valid));
  });

  test.each([
    [
      "an actor that is not a Discord snowflake",
      { ...valid, actorDiscordId: "'abc'" },
      "ScoutOperatorAuditEvent_text_shape_check",
    ],
    [
      "an empty action",
      { ...valid, action: "''" },
      "ScoutOperatorAuditEvent_text_shape_check",
    ],
    [
      "an empty idempotency key",
      { ...valid, idempotencyKey: "''" },
      "ScoutOperatorAuditEvent_text_shape_check",
    ],
  ])("rejects %s", async (_name, values, constraint) => {
    await expectRejected(
      insertSql("ScoutOperatorAuditEvent", values),
      constraint,
    );
  });
});
