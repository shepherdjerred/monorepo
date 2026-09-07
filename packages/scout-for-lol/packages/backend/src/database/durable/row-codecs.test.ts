import { describe, expect, test } from "vitest";
import {
  matchObservationRecordToRow,
  matchObservationRowToRecord,
} from "#src/database/durable/observation-row.ts";
import {
  matchProcessingReceiptRecordToRow,
  matchProcessingReceiptRowToRecord,
} from "#src/database/durable/receipt-row.ts";
import {
  matchNotificationIntentRecordToRow,
  matchNotificationIntentRowToRecord,
} from "#src/database/durable/intent-row.ts";
import {
  matchRecoveryBatchRecordToRow,
  matchRecoveryBatchRowToRecord,
} from "#src/database/durable/recovery-row.ts";
import {
  scoutWorkflowStartRecordToRow,
  scoutWorkflowStartRowToRecord,
} from "#src/database/durable/workflow-start-row.ts";
import { scoutOperatorAuditEventRowToRecord } from "#src/database/durable/audit-event-row.ts";
import {
  matchTrackedAccountRecordToRow,
  matchTrackedAccountRowToRecord,
} from "#src/database/durable/tracked-account-row.ts";

/**
 * Row -> domain record -> row round-trips for every durable model, covering
 * every member of each state vocabulary. The row is the fixed point: the
 * database normalises instants to UTC milliseconds, so a stored row must map
 * into the domain unions and back without changing a single column.
 */

const MATCH_ID = "NA1_5312279829";
const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "300000000000000001";
const ACCOUNT_DISCORD_ID = "200000000000000001";
const MESSAGE_ID = "400000000000000001";
const DIGEST = "a".repeat(64);
const PAYLOAD = JSON.stringify({
  kind: "match-report",
  version: 1,
  data: { body: "hello" },
});
const AT = new Date("2026-09-07T10:00:00.000Z");
const LATER = new Date("2026-09-07T11:00:00.000Z");

describe("MatchObservation codec", () => {
  const baseRow = {
    riotMatchId: MATCH_ID,
    platformRoute: "NA1",
    processingPolicy: "ARCHIVE_ONLY",
    pipelineOwner: null,
    promotedAt: null,
    gameCreatedAt: AT,
    observedAt: LATER,
    matchObjectKey: null,
    matchDigest: null,
    timelineObjectKey: null,
    timelineDigest: null,
  };

  const variants = [
    ["archive-only unowned", baseRow],
    [
      "full promoted legacy-v1 with artifacts",
      {
        ...baseRow,
        processingPolicy: "FULL",
        pipelineOwner: "LEGACY_V1",
        promotedAt: LATER,
        matchObjectKey: "games/2026/09/07/NA1_5312279829/match.json",
        matchDigest: DIGEST,
        timelineObjectKey: "games/2026/09/07/NA1_5312279829/timeline.json",
        timelineDigest: DIGEST,
      },
    ],
    [
      "full born-full temporal-v2",
      { ...baseRow, processingPolicy: "FULL", pipelineOwner: "TEMPORAL_V2" },
    ],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = matchObservationRowToRecord(row);
    expect(matchObservationRecordToRow(record)).toEqual(row);
  });

  test("rejects a promotion on an ARCHIVE_ONLY row", () => {
    expect(() =>
      matchObservationRowToRecord({ ...baseRow, promotedAt: LATER }),
    ).toThrow(/promotion/);
  });

  test("rejects an unpaired artifact reference", () => {
    expect(() =>
      matchObservationRowToRecord({ ...baseRow, matchDigest: DIGEST }),
    ).toThrow(/paired/);
  });

  test("rejects an unknown owner column value", () => {
    expect(() =>
      matchObservationRowToRecord({ ...baseRow, pipelineOwner: "V3" }),
    ).toThrow(/pipelineOwner/);
  });

  test("rejects a platform route that is not the match id prefix", () => {
    expect(() =>
      matchObservationRowToRecord({ ...baseRow, platformRoute: "EUW1" }),
    ).toThrow(/prefix/);
  });
});

describe("MatchProcessingReceipt codec", () => {
  const baseRow = {
    riotMatchId: MATCH_ID,
    kind: "report-posted",
    version: 2,
    scopeKind: "global",
    scopeGuildId: null,
    scopeAccountId: null,
    scopeKey: "global",
    evidence: null,
    recordedAt: AT,
  };

  const variants = [
    ["global scope", baseRow],
    [
      "guild scope with evidence",
      {
        ...baseRow,
        scopeKind: "guild",
        scopeGuildId: GUILD_ID,
        scopeKey: `guild:${GUILD_ID}`,
        evidence: JSON.stringify({ messageId: MESSAGE_ID }),
      },
    ],
    [
      "account scope",
      {
        ...baseRow,
        scopeKind: "account",
        scopeAccountId: 42,
        scopeKey: "account:42",
      },
    ],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = matchProcessingReceiptRowToRecord(row);
    expect(matchProcessingReceiptRecordToRow(record)).toEqual(row);
  });

  test("rejects a scopeKey that disagrees with the scope columns", () => {
    expect(() =>
      matchProcessingReceiptRowToRecord({ ...baseRow, scopeKey: "guild:1" }),
    ).toThrow(/scopeKey/);
  });

  test("rejects an unknown scope kind", () => {
    expect(() =>
      matchProcessingReceiptRowToRecord({ ...baseRow, scopeKind: "server" }),
    ).toThrow(/scopeKind/);
  });
});

describe("MatchNotificationIntent codec", () => {
  const baseRow = {
    intentKey: "intent-NA1_5312279829-post-match",
    riotMatchId: MATCH_ID,
    targetKind: "channel",
    targetId: CHANNEL_ID,
    state: "pending",
    attemptCount: 0,
    attemptNonce: null,
    sendStartedAt: null,
    deliveredAt: null,
    messageId: null,
    suppressedReason: null,
    unknownObservedAt: null,
    lastFailure: null,
    freshnessDeadline: LATER,
    payload: PAYLOAD,
    createdAt: AT,
  };

  const variants = [
    ["pending", baseRow],
    ["ready", { ...baseRow, state: "ready" }],
    [
      "sending",
      {
        ...baseRow,
        state: "sending",
        attemptCount: 1,
        attemptNonce: "nonce-1",
        sendStartedAt: AT,
      },
    ],
    [
      "delivered with message id",
      {
        ...baseRow,
        state: "delivered",
        attemptCount: 1,
        deliveredAt: LATER,
        messageId: MESSAGE_ID,
      },
    ],
    [
      "delivered without message id",
      { ...baseRow, state: "delivered", attemptCount: 1, deliveredAt: LATER },
    ],
    [
      "suppressed",
      { ...baseRow, state: "suppressed", suppressedReason: "stale" },
    ],
    ["expired", { ...baseRow, state: "expired" }],
    ["permission-denied", { ...baseRow, state: "permission-denied" }],
    [
      "unknown-delivery with a recorded failure",
      {
        ...baseRow,
        state: "unknown-delivery",
        attemptCount: 2,
        attemptNonce: "nonce-2",
        unknownObservedAt: LATER,
        lastFailure: JSON.stringify({
          classification: "retryable",
          reason: "timeout",
        }),
      },
    ],
    [
      "dm target",
      { ...baseRow, targetKind: "dm", targetId: ACCOUNT_DISCORD_ID },
    ],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = matchNotificationIntentRowToRecord(row);
    expect(matchNotificationIntentRecordToRow(record)).toEqual(row);
  });

  test("rejects sending without an attempt nonce", () => {
    expect(() =>
      matchNotificationIntentRowToRecord({
        ...baseRow,
        state: "sending",
        attemptCount: 1,
        sendStartedAt: AT,
      }),
    ).toThrow();
  });

  test("rejects sending with a zero attempt count", () => {
    expect(() =>
      matchNotificationIntentRowToRecord({
        ...baseRow,
        state: "sending",
        attemptNonce: "nonce-1",
        sendStartedAt: AT,
      }),
    ).toThrow(/attemptCount/);
  });

  test("rejects a payload column that is not a versioned envelope", () => {
    expect(() =>
      matchNotificationIntentRowToRecord({
        ...baseRow,
        payload: JSON.stringify({ body: "hello" }),
      }),
    ).toThrow();
  });

  test("rejects an unknown state column value", () => {
    expect(() =>
      matchNotificationIntentRowToRecord({ ...baseRow, state: "queued" }),
    ).toThrow(/state/);
  });
});

describe("MatchRecoveryBatch codec", () => {
  const baseRow = {
    recoveryBatchId: "recovery-2026-09-07",
    policy: "normal",
    state: "planned",
    cursorPosition: null,
    pagesScanned: null,
    pageBudget: null,
    discoveredCount: null,
    succeededCount: null,
    suppressedCount: null,
    failedCount: null,
    abandonReason: null,
    workflowId: null,
    createdAt: AT,
  };

  const variants = [
    ["planned", baseRow],
    [
      "scanning before the first advance",
      { ...baseRow, state: "scanning", pagesScanned: 0, pageBudget: 5 },
    ],
    [
      "scanning mid-scan under stale-private-only",
      {
        ...baseRow,
        policy: "stale-private-only",
        state: "scanning",
        cursorPosition: "page-3",
        pagesScanned: 3,
        pageBudget: 5,
        workflowId: "recovery-workflow-1",
      },
    ],
    [
      "processing under no-external",
      {
        ...baseRow,
        policy: "no-external",
        state: "processing",
        discoveredCount: 10,
        succeededCount: 4,
        suppressedCount: 2,
        failedCount: 1,
      },
    ],
    ["digesting", { ...baseRow, state: "digesting" }],
    ["complete", { ...baseRow, state: "complete" }],
    [
      "abandoned",
      { ...baseRow, state: "abandoned", abandonReason: "superseded" },
    ],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = matchRecoveryBatchRowToRecord(row);
    expect(matchRecoveryBatchRecordToRow(record)).toEqual(row);
  });

  test("rejects a scanning row without a page budget", () => {
    expect(() =>
      matchRecoveryBatchRowToRecord({
        ...baseRow,
        state: "scanning",
        pagesScanned: 0,
      }),
    ).toThrow();
  });

  test("rejects a cursor position with zero pages scanned", () => {
    expect(() =>
      matchRecoveryBatchRowToRecord({
        ...baseRow,
        state: "scanning",
        cursorPosition: "page-1",
        pagesScanned: 0,
        pageBudget: 5,
      }),
    ).toThrow(/position/);
  });

  test("rejects counts that exceed discovered", () => {
    expect(() =>
      matchRecoveryBatchRowToRecord({
        ...baseRow,
        state: "processing",
        discoveredCount: 2,
        succeededCount: 2,
        suppressedCount: 1,
        failedCount: 0,
      }),
    ).toThrow(/discovered/);
  });

  test("rejects an unknown state column value", () => {
    expect(() =>
      matchRecoveryBatchRowToRecord({ ...baseRow, state: "paused" }),
    ).toThrow(/state/);
  });
});

describe("ScoutWorkflowStart codec", () => {
  const baseRow = {
    requestedWorkflowId: "scout-recovery-2026-09-07",
    workflowType: "match-recovery",
    requestedBy: null,
    requestSource: "operator-command",
    inputPayload: PAYLOAD,
    requestedAt: AT,
    acceptedAt: null,
    runId: null,
  };

  const variants = [
    ["requested only", baseRow],
    [
      "accepted with run id",
      {
        ...baseRow,
        requestedBy: ACCOUNT_DISCORD_ID,
        acceptedAt: LATER,
        runId: "run-abc-123",
      },
    ],
    ["accepted without run id", { ...baseRow, acceptedAt: LATER }],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = scoutWorkflowStartRowToRecord(row);
    expect(scoutWorkflowStartRecordToRow(record)).toEqual(row);
  });

  test("rejects a run id without acceptance", () => {
    expect(() =>
      scoutWorkflowStartRowToRecord({ ...baseRow, runId: "run-abc-123" }),
    ).toThrow(/runId/);
  });
});

describe("MatchTrackedAccount codec", () => {
  const baseRow = {
    riotMatchId: MATCH_ID,
    puuid: "p".repeat(78),
    playerId: null,
    accountId: null,
    cursorAdvancedAt: null,
  };

  const variants = [
    ["unregistered account", baseRow],
    [
      "registered account with an advanced cursor",
      { ...baseRow, playerId: 7, accountId: 11, cursorAdvancedAt: LATER },
    ],
  ] as const;

  test.each(variants)("round-trips %s", (_name, row) => {
    const record = matchTrackedAccountRowToRecord(row);
    expect(matchTrackedAccountRecordToRow(record)).toEqual(row);
  });
});

describe("ScoutOperatorAuditEvent codec", () => {
  test("parses a stored event", () => {
    const record = scoutOperatorAuditEventRowToRecord({
      id: 1,
      actorDiscordId: ACCOUNT_DISCORD_ID,
      action: "recovery-policy-released",
      subjectKind: "recovery-batch",
      subjectId: "recovery-2026-09-07",
      detail: JSON.stringify({ from: "no-external", to: "stale-private-only" }),
      createdAt: AT,
    });
    expect(record.actorDiscordId).toBe(ACCOUNT_DISCORD_ID);
    expect(record.detail).toEqual({
      from: "no-external",
      to: "stale-private-only",
    });
    expect(record.createdAt).toBe("2026-09-07T10:00:00.000Z");
  });

  test("rejects a detail column that is not JSON", () => {
    expect(() =>
      scoutOperatorAuditEventRowToRecord({
        id: 2,
        actorDiscordId: ACCOUNT_DISCORD_ID,
        action: "x",
        subjectKind: "y",
        subjectId: "z",
        detail: "not json",
        createdAt: AT,
      }),
    ).toThrow();
  });
});
