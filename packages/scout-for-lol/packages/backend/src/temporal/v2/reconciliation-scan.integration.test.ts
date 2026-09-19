import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
  type RecoveryBatchId,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
  type NotificationIntentOrigin,
  type NotificationIntentState,
  type NotificationTarget,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { PipelineOwner } from "@scout-for-lol/domain/match-processing/states.ts";
import type { RecoveryPolicy } from "@scout-for-lol/domain/recovery/batch.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal/contracts";
import { SCOUT_WORKFLOW_NAMES } from "@scout-for-lol/temporal/identifiers";
import {
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
  scoutV2MatchStageConflictEvidenceCodec,
  scoutV2MatchStageEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts-v2";
import type { ScoutReconciliationScanV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testPuuid } from "#src/testing/test-ids.ts";
import { upsertIntent } from "#src/database/durable/intent-repository.ts";
import { observeMatch } from "#src/database/durable/observation-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  createRecoveryBatch,
  type CreateRecoveryBatchResult,
} from "#src/database/durable/recovery-repository.ts";
import { matchRecoveryBatchRowToRecord } from "#src/database/durable/recovery-row.ts";
import { matchTrackedAccountRowToRecord } from "#src/database/durable/tracked-account-row.ts";
import {
  markTrackedAccountCursorAdvanced,
  recordTrackedAccounts,
} from "#src/database/durable/tracked-account-repository.ts";
import {
  recordWorkflowStartAccepted,
  requestWorkflowStart,
  type RequestWorkflowStartResult,
} from "#src/database/durable/workflow-start-repository.ts";
import { buildMatchReceipt } from "#src/durable/match/receipt-evidence.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";

/**
 * One reconciliation page, derived from real rows in every one of its five
 * families.
 *
 * The sweep re-derives its page from the durable tables on every run rather
 * than from a stored cursor, so what this file pins down is which rows the
 * durable state says nothing is driving — and, just as importantly, which rows
 * it must leave alone. Each family is seeded with both a row that belongs on
 * the page and a row that deliberately does not.
 *
 * The Activity reads the module-level Prisma singleton, so the singleton is
 * pointed at this file's own database rather than replaced: the database module
 * reads `DATABASE_URL` when it is first imported and the pg pool connects
 * lazily, so setting it beforehand gives the production client an isolated,
 * migrated database.
 */
const testDatabase = createTestDatabase("temporal-v2-reconciliation-scan");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const {
  buildReceipt,
  lakeStagingReceiptKind,
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
} = await import("#src/report-lake/durable-receipts.ts");
const { scanPipelineReconciliationPageV2 } =
  await import("#src/temporal/v2/reconciliation-scan.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = ScoutStageSchema.parse("dev");
const AT = new Date("2026-09-12T10:00:00.000Z");
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-12T10:00:00.000Z");
const GAME_CREATED_AT = IsoInstantSchema.parse("2026-09-12T09:00:00.000Z");
const CURSOR_ADVANCED_AT = IsoInstantSchema.parse("2026-09-12T10:05:00.000Z");
const NONCE = NotificationAttemptNonceSchema.parse("attempt-a");
const MESSAGE_ID = DiscordMessageIdSchema.parse("300000000000000001");

/**
 * A drivable intent is one the sweep can still finish, and the deadline is the
 * sort key as well as the filter. Distinct deadlines here make the page's order
 * a property of the data rather than of which row Postgres happened to hold
 * first — and the settled intents get the EARLIEST deadline of all, so a bug
 * that let one onto the page would put it at the front where it cannot hide.
 */
const SETTLED_DEADLINE = "2098-01-01T00:00:00.000Z";
const PENDING_DEADLINE = "2099-01-01T00:00:00.000Z";
const READY_DEADLINE = "2099-01-01T01:00:00.000Z";
const SENDING_DEADLINE = "2099-01-01T02:00:00.000Z";
const PASSED_DEADLINE = "2020-01-01T00:00:00.000Z";

const STALLED_MATCH = RiotMatchIdSchema.parse("NA1_850001");
const CONTESTED_MATCH = RiotMatchIdSchema.parse("NA1_850009");
const FINISHED_MATCH = RiotMatchIdSchema.parse("NA1_850002");
const LEGACY_MATCH = RiotMatchIdSchema.parse("NA1_850003");
const ARCHIVE_ONLY_MATCH = RiotMatchIdSchema.parse("NA1_850004");
const ACCEPTED_START_MATCH = RiotMatchIdSchema.parse("NA1_850005");
/** Two tracked accounts, and the cursor advance stopped between them. */
const PARTIAL_CURSOR_MATCH = RiotMatchIdSchema.parse("NA1_850006");
/** Two tracked accounts, both advanced: the phase really is finished. */
const WHOLE_CURSOR_MATCH = RiotMatchIdSchema.parse("NA1_850007");
const UNPROJECTED_MATCH = RiotMatchIdSchema.parse("NA1_860001");
const PROJECTED_MATCH = RiotMatchIdSchema.parse("NA1_860002");
const REQUESTED_LAKE_MATCH = RiotMatchIdSchema.parse("NA1_860003");

const LIVE_BATCH = RecoveryBatchIdSchema.parse("rc-live");
const COMPLETE_BATCH = RecoveryBatchIdSchema.parse("rc-complete");
const ABANDONED_BATCH = RecoveryBatchIdSchema.parse("rc-abandoned");
const REQUESTED_BATCH = RecoveryBatchIdSchema.parse("rc-requested");

function intentKey(name: string): NotificationIntentKey {
  return NotificationIntentKeySchema.parse(
    `postmatch-discord:NA1_870000:${name}`,
  );
}

const HELD_DEADLINE = "2099-01-01T03:00:00.000Z";
const RELEASED_DEADLINE = "2099-01-01T04:00:00.000Z";
const NO_EXTERNAL_BATCH = RecoveryBatchIdSchema.parse("recon-no-external");
const STALE_PRIVATE_BATCH = RecoveryBatchIdSchema.parse("recon-stale-private");
const HELD_NO_EXTERNAL_INTENT = intentKey("held-no-external");
const HELD_STALE_CHANNEL_INTENT = intentKey("held-stale-channel");
const RELEASED_DM_INTENT = intentKey("released-dm");
const PENDING_INTENT = intentKey("pending");
const READY_INTENT = intentKey("ready");
const SENDING_INTENT = intentKey("sending");
const STALE_INTENT = intentKey("stale");
const REQUESTED_INTENT = intentKey("requested");

async function seedObservation(args: {
  matchId: RiotMatchId;
  policy: "ARCHIVE_ONLY" | "FULL";
  owner: PipelineOwner;
}): Promise<void> {
  expect(
    await observeMatch(prisma, {
      matchId: args.matchId,
      platformRoute: platformRouteOf(args.matchId),
      policy: args.policy,
      owner: args.owner,
      promotion: null,
      gameCreatedAt: GAME_CREATED_AT,
      observedAt: OBSERVED_AT,
      deliveryMode: "live",
      artifacts: { match: null, timeline: null },
    }),
  ).toEqual({ outcome: "applied" });
}

/** The stage receipt that says the V2 core's observation phase completed. */
async function seedObservationReceipt(matchId: RiotMatchId): Promise<void> {
  expect(
    await recordReceipt(
      prisma,
      buildMatchReceipt({
        matchId,
        kind: SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
        scope: { kind: "global" },
        recordedAt: OBSERVED_AT,
        evidence: scoutV2MatchStageEvidenceCodec.serialize({
          riotMatchId: matchId,
          phase: "observation",
        }),
      }),
    ),
  ).toEqual({ outcome: "applied" });
}

/** The marker the receipts Activity leaves when a stage receipt is contested. */
async function seedStageConflictMarker(matchId: RiotMatchId): Promise<void> {
  expect(
    await recordReceipt(
      prisma,
      buildMatchReceipt({
        matchId,
        kind: SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
        scope: { kind: "global" },
        recordedAt: OBSERVED_AT,
        evidence: scoutV2MatchStageConflictEvidenceCodec.serialize({
          riotMatchId: matchId,
        }),
      }),
    ),
  ).toEqual({ outcome: "applied" });
}

/** One tracked account whose post-match cursor has already moved. */
async function seedAdvancedCursor(matchId: RiotMatchId): Promise<void> {
  const puuid = testPuuid(matchId);
  expect(
    await recordTrackedAccounts(prisma, [
      matchTrackedAccountRowToRecord({
        riotMatchId: matchId,
        puuid,
        playerId: null,
        accountId: null,
        cursorAdvancedAt: null,
      }),
    ]),
  ).toEqual({ recorded: 1, existing: 0 });
  expect(
    await markTrackedAccountCursorAdvanced(prisma, {
      matchId,
      puuid,
      advancedAt: CURSOR_ADVANCED_AT,
    }),
  ).toEqual({ outcome: "applied" });
}

/**
 * Two tracked accounts on one match, advancing only the ones asked for.
 *
 * `cursorAdvancedAt` is per ACCOUNT and the advance walks the associations one
 * at a time, so "this match's cursor phase is done" is a claim about ALL of
 * them. A match seeded with one advanced and one not is exactly the state a run
 * that died between two accounts leaves behind.
 */
async function seedPartialCursors(
  matchId: RiotMatchId,
  advanced: "first-only" | "both",
): Promise<void> {
  const puuids = [testPuuid(`${matchId}-a`), testPuuid(`${matchId}-b`)];
  expect(
    await recordTrackedAccounts(
      prisma,
      puuids.map((puuid) =>
        matchTrackedAccountRowToRecord({
          riotMatchId: matchId,
          puuid,
          playerId: null,
          accountId: null,
          cursorAdvancedAt: null,
        }),
      ),
    ),
  ).toEqual({ recorded: 2, existing: 0 });
  const toAdvance = advanced === "both" ? puuids : puuids.slice(0, 1);
  for (const puuid of toAdvance) {
    expect(
      await markTrackedAccountCursorAdvanced(prisma, {
        matchId,
        puuid,
        advancedAt: CURSOR_ADVANCED_AT,
      }),
    ).toEqual({ outcome: "applied" });
  }
}

async function seedLakeReceipts(
  matchId: RiotMatchId,
  projected: "archived-only" | "archived-and-staged",
): Promise<void> {
  const descriptor = ArtifactDescriptorSchema.parse({
    kind: "match",
    key: `games/2026/09/12/${matchId}/match.json`,
    digest: (matchId.split("_")[1] ?? "0").padStart(64, "b"),
    bytes: 2048,
    contentType: "application/json",
    capturedAt: "2026-09-12T09:05:00.000Z",
  });
  await recordReceipt(
    prisma,
    buildReceipt({
      matchId,
      kind: rawArchiveReceiptKind("match"),
      evidence: rawArchiveEvidenceCodec.serialize(descriptor),
      recordedAt: AT,
    }),
  );
  if (projected === "archived-and-staged") {
    await recordReceipt(
      prisma,
      buildReceipt({
        matchId,
        kind: lakeStagingReceiptKind("match"),
        evidence: { kind: "lake-staging-evidence", version: 1, data: {} },
        recordedAt: AT,
      }),
    );
  }
}

async function seedIntent(args: {
  key: NotificationIntentKey;
  state: NotificationIntentState;
  attemptCount: number;
  freshnessDeadline: string;
  origin?: NotificationIntentOrigin;
  target?: NotificationTarget;
}): Promise<void> {
  expect(
    await upsertIntent(prisma, {
      matchId: RiotMatchIdSchema.parse("NA1_870000"),
      intent: NotificationIntentSchema.parse({
        key: args.key,
        kind: "postmatch",
        origin: args.origin ?? { kind: "live" },
        target: args.target ?? {
          kind: "channel",
          channelId: testChannelId("8700"),
        },
        freshnessDeadline: args.freshnessDeadline,
        createdAt: "2026-09-12T09:00:00.000Z",
        attemptCount: args.attemptCount,
        state: args.state,
      }),
    }),
  ).toEqual({ outcome: "applied" });
}

async function seedBatch(
  recoveryBatchId: RecoveryBatchId,
  state: string,
  abandonReason: string | null,
  policy: RecoveryPolicy = "normal",
): Promise<CreateRecoveryBatchResult> {
  return await createRecoveryBatch(
    prisma,
    matchRecoveryBatchRowToRecord({
      recoveryBatchId,
      policy,
      state,
      cursorPosition: null,
      pagesScanned: null,
      pageBudget: null,
      discoveredCount: null,
      succeededCount: null,
      suppressedCount: null,
      failedCount: null,
      abandonReason,
      workflowId: null,
      createdAt: AT,
    }),
  );
}

async function seedWorkflowStart(args: {
  requestedWorkflowId: string;
  workflowType: string;
  data: Record<string, unknown>;
  acceptedAt: Date | null;
}): Promise<RequestWorkflowStartResult> {
  const requested = await requestWorkflowStart(prisma, {
    requestedWorkflowId: args.requestedWorkflowId,
    workflowType: args.workflowType,
    requestedBy: null,
    requestSource: "operator-command",
    // The expected-kind contract: a start's input envelope kind IS its type.
    inputPayload: {
      kind: args.workflowType,
      version: 1,
      data: { stage: STAGE, ...args.data },
    },
    requestedAt: IsoInstantSchema.parse(AT.toISOString()),
  });
  if (args.acceptedAt !== null && requested.outcome !== "conflict") {
    await recordWorkflowStartAccepted(prisma, {
      requestId: requested.record.requestId,
      acceptedAt: IsoInstantSchema.parse(args.acceptedAt.toISOString()),
      runId: null,
    });
  }
  return requested;
}

async function seedMatchProcessingFamily(): Promise<void> {
  // Stalled: the V2 core owns it and the observation phase never attested, so
  // nothing downstream of the commit can have run.
  await seedObservation({
    matchId: STALLED_MATCH,
    policy: "FULL",
    owner: { kind: "temporal-v2" },
  });
  await seedAdvancedCursor(STALLED_MATCH);
  // Stalled in exactly the same way, but contested: an operator's, not the
  // sweep's.
  await seedObservation({
    matchId: CONTESTED_MATCH,
    policy: "FULL",
    owner: { kind: "temporal-v2" },
  });
  await seedStageConflictMarker(CONTESTED_MATCH);

  // Finished: both halves of "this match is done" are recorded. They are
  // checked separately because they fail separately — a run that committed the
  // observation and died before the cursors moved is exactly what the family
  // exists to find.
  await seedObservation({
    matchId: FINISHED_MATCH,
    policy: "FULL",
    owner: { kind: "temporal-v2" },
  });
  await seedObservationReceipt(FINISHED_MATCH);
  await seedAdvancedCursor(FINISHED_MATCH);

  // Partly advanced: the observation attested, then the cursor advance moved
  // one of two accounts and stopped. The match is NOT finished — the second
  // account's cursor is stuck, and nothing else will ever move it — so the
  // sweep has to surface it. Asking whether NO account had advanced would be
  // satisfied by the first one and lose this match forever.
  await seedObservation({
    matchId: PARTIAL_CURSOR_MATCH,
    policy: "FULL",
    owner: { kind: "temporal-v2" },
  });
  await seedObservationReceipt(PARTIAL_CURSOR_MATCH);
  await seedPartialCursors(PARTIAL_CURSOR_MATCH, "first-only");

  // The same shape with both accounts advanced, which is what "done" means.
  await seedObservation({
    matchId: WHOLE_CURSOR_MATCH,
    policy: "FULL",
    owner: { kind: "temporal-v2" },
  });
  await seedObservationReceipt(WHOLE_CURSOR_MATCH);
  await seedPartialCursors(WHOLE_CURSOR_MATCH, "both");

  // Both pipelines are live, so driving a V2 child onto a v1-owned match is how
  // one match gets processed twice — and an ARCHIVE_ONLY match has no
  // downstream phase to be stalled short of.
  await seedObservation({
    matchId: LEGACY_MATCH,
    policy: "FULL",
    owner: { kind: "legacy-v1" },
  });
  await seedObservation({
    matchId: ARCHIVE_ONLY_MATCH,
    policy: "ARCHIVE_ONLY",
    owner: { kind: "temporal-v2" },
  });
}

async function seedNotificationFamily(): Promise<void> {
  await seedIntent({
    key: PENDING_INTENT,
    state: { kind: "pending" },
    attemptCount: 0,
    freshnessDeadline: PENDING_DEADLINE,
  });
  await seedIntent({
    key: READY_INTENT,
    state: { kind: "ready" },
    attemptCount: 0,
    freshnessDeadline: READY_DEADLINE,
  });
  await seedIntent({
    key: SENDING_INTENT,
    state: { kind: "sending", attemptNonce: NONCE, startedAt: OBSERVED_AT },
    attemptCount: 1,
    freshnessDeadline: SENDING_DEADLINE,
  });
  await seedIntent({
    key: STALE_INTENT,
    state: { kind: "pending" },
    attemptCount: 0,
    freshnessDeadline: PASSED_DEADLINE,
  });

  // Recovery-born intents under the two policies that hold. The batch rows
  // are terminal so they never reach the recovery family's own page, and the
  // policy is what the sweep must read: a held intent is deliberately not
  // being driven, and a sweep that surfaced it would start a child on it
  // every minute until the batch is released.
  expect(
    await seedBatch(NO_EXTERNAL_BATCH, "complete", null, "no-external"),
  ).toEqual({ outcome: "applied" });
  expect(
    await seedBatch(
      STALE_PRIVATE_BATCH,
      "complete",
      null,
      "stale-private-only",
    ),
  ).toEqual({ outcome: "applied" });
  await seedIntent({
    key: HELD_NO_EXTERNAL_INTENT,
    state: { kind: "ready" },
    attemptCount: 0,
    freshnessDeadline: HELD_DEADLINE,
    origin: { kind: "recovery", recoveryBatchId: NO_EXTERNAL_BATCH },
  });
  await seedIntent({
    key: HELD_STALE_CHANNEL_INTENT,
    state: { kind: "ready" },
    attemptCount: 0,
    freshnessDeadline: HELD_DEADLINE,
    origin: { kind: "recovery", recoveryBatchId: STALE_PRIVATE_BATCH },
  });
  await seedIntent({
    key: RELEASED_DM_INTENT,
    state: { kind: "ready" },
    attemptCount: 0,
    freshnessDeadline: RELEASED_DEADLINE,
    origin: { kind: "recovery", recoveryBatchId: STALE_PRIVATE_BATCH },
    target: {
      kind: "dm",
      accountId: DiscordAccountIdSchema.parse("200000000000000002"),
    },
  });

  const settled: {
    name: string;
    state: NotificationIntentState;
    attempts: number;
  }[] = [
    {
      name: "delivered",
      state: {
        kind: "delivered",
        messageId: MESSAGE_ID,
        deliveredAt: OBSERVED_AT,
      },
      attempts: 1,
    },
    {
      name: "suppressed",
      state: { kind: "suppressed", reason: "stale" },
      attempts: 0,
    },
    { name: "expired", state: { kind: "expired" }, attempts: 0 },
    {
      name: "permission-denied",
      state: { kind: "permission-denied" },
      attempts: 1,
    },
    {
      name: "unknown-delivery",
      state: {
        kind: "unknown-delivery",
        attemptNonce: NONCE,
        observedAt: OBSERVED_AT,
      },
      attempts: 1,
    },
  ];
  for (const entry of settled) {
    await seedIntent({
      key: intentKey(entry.name),
      state: entry.state,
      attemptCount: entry.attempts,
      freshnessDeadline: SETTLED_DEADLINE,
    });
  }
}

let page: ScoutReconciliationScanV2Result;

beforeAll(async () => {
  await seedMatchProcessingFamily();
  await seedNotificationFamily();
  await seedLakeReceipts(UNPROJECTED_MATCH, "archived-only");
  await seedLakeReceipts(PROJECTED_MATCH, "archived-and-staged");

  expect(await seedBatch(LIVE_BATCH, "planned", null)).toEqual({
    outcome: "applied",
  });
  expect(await seedBatch(COMPLETE_BATCH, "complete", null)).toEqual({
    outcome: "applied",
  });
  expect(
    await seedBatch(ABANDONED_BATCH, "abandoned", "operator-cancelled"),
  ).toEqual({ outcome: "applied" });

  // One unacknowledged start per family, plus an accepted one that must not be
  // re-driven. The match-processing request names the match the durable state
  // already reports as stalled, which is the de-duplication case.
  await seedWorkflowStart({
    requestedWorkflowId: "scout-dev-match-v2-850001",
    workflowType: SCOUT_WORKFLOW_NAMES.matchProcessingV2,
    data: { riotMatchId: STALLED_MATCH },
    acceptedAt: null,
  });
  await seedWorkflowStart({
    requestedWorkflowId: "scout-dev-notification-v2-requested",
    workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
    data: { intentKey: REQUESTED_INTENT },
    acceptedAt: null,
  });
  await seedWorkflowStart({
    requestedWorkflowId: "scout-dev-lake-v2-860003",
    workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
    data: { riotMatchId: REQUESTED_LAKE_MATCH },
    acceptedAt: null,
  });
  await seedWorkflowStart({
    requestedWorkflowId: "scout-dev-recovery-v2-requested",
    workflowType: SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
    data: { recoveryBatchId: REQUESTED_BATCH },
    acceptedAt: null,
  });
  await seedWorkflowStart({
    requestedWorkflowId: "scout-dev-match-v2-850005",
    workflowType: SCOUT_WORKFLOW_NAMES.matchProcessingV2,
    data: { riotMatchId: ACCEPTED_START_MATCH },
    acceptedAt: AT,
  });

  page = await scanPipelineReconciliationPageV2({
    stage: STAGE,
    trigger: "schedule",
  });
});

describe("the match-processing family", () => {
  test("finds the V2-owned match whose observation phase never attested", () => {
    // A v1-owned match is v1's to reconcile and an ARCHIVE_ONLY match has no
    // phase to be stalled short of, so neither belongs on this page — and the
    // finished match proves the receipt check is what excludes it, since its
    // cursor advance is recorded exactly like the stalled match's.
    expect(page.pending.matchProcessing).toEqual([
      STALLED_MATCH,
      PARTIAL_CURSOR_MATCH,
    ]);
    // The cursor phase is only finished when EVERY association has moved.
    expect(page.pending.matchProcessing).not.toContain(WHOLE_CURSOR_MATCH);
  });

  test("leaves a contested match to the operator rather than driving it", () => {
    // Its observation phase never attested either, so by every other measure
    // it is stalled. A child started on it refuses at its resume point until
    // the marker is removed, so driving it each sweep would be a failing child
    // per tick reporting the same fact.
    expect(page.pending.matchProcessing).not.toContain(CONTESTED_MATCH);
  });

  test("counts a re-requested start and a stalled row as one piece of work", () => {
    // A match that is both stalled and re-requested must not cost two page
    // slots, and the child would collapse onto one deterministic Workflow ID
    // anyway — two entries would just make the page report a backlog it does
    // not have.
    const occurrences = page.pending.matchProcessing.filter(
      (id) => id === STALLED_MATCH,
    );
    expect(occurrences).toHaveLength(1);
    expect(page.pending.matchProcessing).not.toContain(ACCEPTED_START_MATCH);
  });
});

describe("the notification family", () => {
  test("drives only intents that are still worth sending", () => {
    // `unknown-delivery` is the one that matters: it is the domain's operator
    // dead end, and starting a child on it is precisely how a user gets told
    // the same thing twice. The other four are settled, and the stale intent is
    // past its deadline — the machine expires such an intent rather than
    // sending it, so a sweep that started one would be asking for news the user
    // has already had by other means.
    expect(page.pending.notifications).toEqual([
      PENDING_INTENT,
      READY_INTENT,
      SENDING_INTENT,
      RELEASED_DM_INTENT,
      REQUESTED_INTENT,
    ]);
  });

  test("leaves intents their batch policy holds off the page", () => {
    // `notificationDeliveryDecision` said in SQL: `no-external` holds every
    // target and `stale-private-only` holds channels, while the DM under
    // stale-private-only is exactly what a release lets proceed — and it is
    // on the page above. A held intent is not stalled; it is waiting on an
    // operator, and re-driving it would find the gate closed every time.
    expect(page.pending.notifications).not.toContain(HELD_NO_EXTERNAL_INTENT);
    expect(page.pending.notifications).not.toContain(HELD_STALE_CHANNEL_INTENT);
    expect(page.pending.notifications).toContain(RELEASED_DM_INTENT);
  });

  test("excludes every settled state and the operator dead end by name", () => {
    for (const name of [
      "delivered",
      "suppressed",
      "expired",
      "permission-denied",
      "unknown-delivery",
    ]) {
      expect(page.pending.notifications).not.toContain(intentKey(name));
    }
    expect(page.pending.notifications).not.toContain(STALE_INTENT);
  });
});

describe("the lake-projection family", () => {
  test("finds archived matches whose staging never landed", () => {
    // The archive receipt is the precondition rather than the observation row:
    // the lake is a rebuildable projection of the S3 object, so there is
    // something to project exactly when those bytes are known to exist.
    expect(page.pending.lakeProjections).toEqual([
      UNPROJECTED_MATCH,
      REQUESTED_LAKE_MATCH,
    ]);
    expect(page.pending.lakeProjections).not.toContain(PROJECTED_MATCH);
  });
});

describe("the recovery-batch family", () => {
  test("drives batches still inside their machine, and no terminal one", () => {
    // A batch past `processing` has already lost its counts to the row's
    // flattening, so there is nothing a second driver could add; a batch short
    // of that point holds the only record of where its scan got to.
    expect(page.pending.recoveryBatches).toEqual([LIVE_BATCH, REQUESTED_BATCH]);
    expect(page.pending.recoveryBatches).not.toContain(COMPLETE_BATCH);
    expect(page.pending.recoveryBatches).not.toContain(ABANDONED_BATCH);
  });
});

describe("the page as a whole", () => {
  test("reports itself complete because no family filled its budget", () => {
    // `complete` is false exactly when a family FILLED its page, never merely
    // because something was found — a caller that kept sweeping on "found
    // something" would never stop.
    expect(page.complete).toBe(true);
  });
});
