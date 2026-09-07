import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  NotificationIntentSchema,
  type NotificationIntent,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  matchObservationRecordToRow,
  matchObservationRowToRecord,
  MatchObservationRecordSchema,
  type MatchObservationRecord,
} from "#src/database/durable/observation-row.ts";
import {
  matchProcessingReceiptRecordToRow,
  matchProcessingReceiptRowToRecord,
} from "#src/database/durable/receipt-row.ts";
import {
  matchNotificationIntentRecordToRow,
  matchNotificationIntentRowToRecord,
  type MatchNotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";
import {
  matchRecoveryBatchRecordToRow,
  matchRecoveryBatchRowToRecord,
  MatchRecoveryBatchRecordSchema,
  type MatchRecoveryBatchRecord,
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
 * Round-trips for every durable model, covering every member of each state
 * vocabulary, in both directions: a stored row must map into the domain
 * unions and back without changing a column, and a domain value must map to
 * columns and back without changing at all. The database normalises instants
 * to UTC milliseconds, so fixtures use `.000Z` instants.
 */

const MATCH_ID = "NA1_5312279829";
const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "300000000000000001";
const ACCOUNT_DISCORD_ID = "200000000000000001";
const MESSAGE_ID = "400000000000000001";
const DIGEST = "a".repeat(64);
const AT = new Date("2026-09-07T10:00:00.000Z");
const LATER = new Date("2026-09-07T11:00:00.000Z");
const AT_ISO = "2026-09-07T10:00:00.000Z";
const LATER_ISO = "2026-09-07T11:00:00.000Z";

function abandonedRecord(reason: string): MatchRecoveryBatchRecord {
  return MatchRecoveryBatchRecordSchema.parse({
    batch: {
      id: "recovery-2026-09-07",
      policy: "normal",
      createdAt: AT_ISO,
      state: { kind: "abandoned", reason },
    },
    workflowId: null,
  });
}

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

  function observationRecord(artifacts: {
    match: { key: string; digest: string } | null;
    timeline: { key: string; digest: string } | null;
  }): MatchObservationRecord {
    return MatchObservationRecordSchema.parse({
      matchId: MATCH_ID,
      platformRoute: "NA1",
      policy: "ARCHIVE_ONLY",
      owner: { kind: "unowned" },
      promotion: null,
      gameCreatedAt: AT_ISO,
      observedAt: LATER_ISO,
      artifacts,
    });
  }

  const oneArtifactVariants = [
    [
      "only the match artifact stored",
      { match: { key: "k/match.json", digest: DIGEST }, timeline: null },
    ],
    [
      "only the timeline artifact stored",
      { match: null, timeline: { key: "k/timeline.json", digest: DIGEST } },
    ],
  ] as const;

  test.each(oneArtifactVariants)(
    "round-trips a domain observation with %s",
    (_name, artifacts) => {
      const record = observationRecord(artifacts);
      const row = matchObservationRecordToRow(record);
      expect(matchObservationRowToRecord(row)).toEqual(record);
    },
  );

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

  test("rejects a kind that is not the kebab-case ReceiptKind shape", () => {
    expect(() =>
      matchProcessingReceiptRowToRecord({ ...baseRow, kind: "Report:Posted" }),
    ).toThrow();
  });
});

describe("MatchNotificationIntent codec", () => {
  function intent(
    state: Record<string, unknown>,
    extras: Record<string, unknown> = {},
  ): NotificationIntent {
    return NotificationIntentSchema.parse({
      key: "intent-NA1_5312279829-post-match",
      target: { kind: "channel", channelId: CHANNEL_ID },
      freshnessDeadline: LATER_ISO,
      createdAt: AT_ISO,
      attemptCount: 0,
      state,
      ...extras,
    });
  }

  const intentMatchId = RiotMatchIdSchema.parse(MATCH_ID);

  function record(value: NotificationIntent): MatchNotificationIntentRecord {
    return { matchId: intentMatchId, intent: value };
  }

  const variants: readonly (readonly [string, NotificationIntent])[] = [
    ["pending", intent({ kind: "pending" })],
    ["ready", intent({ kind: "ready" })],
    [
      "sending",
      intent(
        { kind: "sending", attemptNonce: "nonce-1", startedAt: AT_ISO },
        { attemptCount: 1 },
      ),
    ],
    [
      "delivered with message id",
      intent(
        { kind: "delivered", messageId: MESSAGE_ID, deliveredAt: LATER_ISO },
        { attemptCount: 1 },
      ),
    ],
    [
      "delivered without message id",
      intent(
        { kind: "delivered", deliveredAt: LATER_ISO },
        { attemptCount: 1 },
      ),
    ],
    ["suppressed stale", intent({ kind: "suppressed", reason: "stale" })],
    [
      "suppressed feature-disabled",
      intent({ kind: "suppressed", reason: "feature-disabled" }),
    ],
    [
      "suppressed recipient-preference",
      intent({ kind: "suppressed", reason: "recipient-preference" }),
    ],
    ["expired", intent({ kind: "expired" })],
    [
      "permission-denied with a terminal failure",
      intent(
        { kind: "permission-denied" },
        {
          attemptCount: 1,
          lastFailure: { classification: "terminal", reason: "dm-disabled" },
        },
      ),
    ],
    [
      "unknown-delivery with a retryable failure",
      intent(
        {
          kind: "unknown-delivery",
          attemptNonce: "nonce-2",
          observedAt: LATER_ISO,
        },
        {
          attemptCount: 2,
          lastFailure: { classification: "retryable", reason: "timeout" },
        },
      ),
    ],
    [
      "dm target",
      NotificationIntentSchema.parse({
        key: "intent-dm",
        target: { kind: "dm", accountId: ACCOUNT_DISCORD_ID },
        freshnessDeadline: LATER_ISO,
        createdAt: AT_ISO,
        attemptCount: 0,
        state: { kind: "pending" },
      }),
    ],
  ];

  test.each(variants)("round-trips %s in both directions", (_name, value) => {
    const original = record(value);
    const row = matchNotificationIntentRecordToRow(original);
    const parsed = matchNotificationIntentRowToRecord(row);
    expect(parsed).toEqual(original);
    expect(matchNotificationIntentRecordToRow(parsed)).toEqual(row);
  });

  test("rejects a payload envelope that disagrees with the columns", () => {
    const row = matchNotificationIntentRecordToRow(
      record(intent({ kind: "pending" })),
    );
    const tampered = {
      ...row,
      payload: matchNotificationIntentRecordToRow(
        record(intent({ kind: "ready" })),
      ).payload,
    };
    expect(() => matchNotificationIntentRowToRecord(tampered)).toThrow(
      /disagrees/,
    );
  });

  test("rejects a payload envelope of a foreign kind", () => {
    const row = matchNotificationIntentRecordToRow(
      record(intent({ kind: "pending" })),
    );
    expect(() =>
      matchNotificationIntentRowToRecord({
        ...row,
        payload: JSON.stringify({
          kind: "artifact-descriptor",
          version: 1,
          data: {},
        }),
      }),
    ).toThrow();
  });

  test("rejects sending without an attempt nonce", () => {
    const row = matchNotificationIntentRecordToRow(
      record(
        intent(
          { kind: "sending", attemptNonce: "nonce-1", startedAt: AT_ISO },
          { attemptCount: 1 },
        ),
      ),
    );
    expect(() =>
      matchNotificationIntentRowToRecord({ ...row, attemptNonce: null }),
    ).toThrow();
  });

  test("rejects a half-present failure column pair", () => {
    const row = matchNotificationIntentRecordToRow(
      record(intent({ kind: "ready" })),
    );
    expect(() =>
      matchNotificationIntentRowToRecord({
        ...row,
        lastFailureClassification: "retryable",
      }),
    ).toThrow();
  });

  test("rejects an unknown state column value", () => {
    const row = matchNotificationIntentRecordToRow(
      record(intent({ kind: "pending" })),
    );
    expect(() =>
      matchNotificationIntentRowToRecord({ ...row, state: "queued" }),
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

  test.each([
    ["operator-cancelled"],
    ["scan-budget-exhausted"],
    ["upstream-unavailable"],
  ])("round-trips a domain batch abandoned for %s", (reason) => {
    const record = abandonedRecord(reason);
    const row = matchRecoveryBatchRecordToRow(record);
    expect(matchRecoveryBatchRowToRecord(row)).toEqual(record);
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
    inputPayload: JSON.stringify({
      kind: "match-recovery",
      version: 1,
      data: { body: "hello" },
    }),
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

  test("rejects an input payload whose kind is not the workflow type", () => {
    expect(() =>
      scoutWorkflowStartRowToRecord({
        ...baseRow,
        inputPayload: JSON.stringify({
          kind: "hall-baseline",
          version: 1,
          data: {},
        }),
      }),
    ).toThrow(/does not match workflowType/);
  });

  test("rejects an input payload that is not a versioned envelope", () => {
    expect(() =>
      scoutWorkflowStartRowToRecord({
        ...baseRow,
        inputPayload: JSON.stringify({ nope: true }),
      }),
    ).toThrow();
  });

  test("rejects an input payload that is not JSON at all", () => {
    expect(() =>
      scoutWorkflowStartRowToRecord({ ...baseRow, inputPayload: "not json" }),
    ).toThrow();
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

  // This codec is the only integrity layer between these rows and the
  // LeaguePuuid/PlayerId/AccountId brands, so malformed columns must throw.
  test("rejects a puuid that is not 78 characters", () => {
    expect(() =>
      matchTrackedAccountRowToRecord({ ...baseRow, puuid: "p".repeat(77) }),
    ).toThrow();
  });

  test("rejects a non-positive player id", () => {
    expect(() =>
      matchTrackedAccountRowToRecord({ ...baseRow, playerId: 0 }),
    ).toThrow();
  });
});

describe("ScoutOperatorAuditEvent codec", () => {
  test("parses a stored event", () => {
    const record = scoutOperatorAuditEventRowToRecord({
      id: 1n,
      actorDiscordId: ACCOUNT_DISCORD_ID,
      action: "recovery-policy-released",
      subjectKind: "recovery-batch",
      subjectId: "recovery-2026-09-07",
      detail: JSON.stringify({ from: "no-external", to: "stale-private-only" }),
      idempotencyKey: "release-1",
      createdAt: AT,
    });
    expect(record.actorDiscordId).toBe(ACCOUNT_DISCORD_ID);
    expect(record.detail).toEqual({
      from: "no-external",
      to: "stale-private-only",
    });
    expect(record.idempotencyKey).toBe("release-1");
    expect(record.createdAt).toBe(AT_ISO);
  });

  test("rejects a detail column that is not JSON", () => {
    expect(() =>
      scoutOperatorAuditEventRowToRecord({
        id: 2n,
        actorDiscordId: ACCOUNT_DISCORD_ID,
        action: "x",
        subjectKind: "y",
        subjectId: "z",
        detail: "not json",
        idempotencyKey: null,
        createdAt: AT,
      }),
    ).toThrow();
  });
});

describe("migration SQL parity", () => {
  test("the hand-written platform route vocabulary matches PlatformRouteSchema", async () => {
    const sql = await Bun.file(
      `${import.meta.dir}/../../../prisma/migrations/20260907000000_durable_match_operational_facts/migration.sql`,
    ).text();
    const inList = /"platformRoute" IN \(([^)]+)\)/.exec(sql);
    if (inList?.[1] === undefined) {
      throw new Error("platform_route_check IN list not found in migration");
    }
    const sqlRoutes = [...inList[1].matchAll(/'([A-Z0-9]+)'/g)].map(
      (match) => match[1] ?? "",
    );
    expect([...sqlRoutes].sort()).toEqual(
      [...PlatformRouteSchema.options].sort(),
    );
  });
});
