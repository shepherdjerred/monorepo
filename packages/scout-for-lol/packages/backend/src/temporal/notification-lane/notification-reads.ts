import { ApplicationFailure } from "@temporalio/common";
import {
  WorkflowRunIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationWorkflowId,
  scoutWorkflowTypesOf,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import type { NotificationTransitionResult } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  ScoutIntentSummarySchema,
  ScoutNotificationIntentResultSchema,
  ScoutNotificationTransitionResultSchema,
  type ScoutIntentSummary,
  type ScoutNotificationIntentResult,
  type ScoutNotificationTransitionResult,
} from "@scout-for-lol/temporal/activity-contracts";
import {
  ScoutDurableCommitSchema,
  type ScoutDurableCommit,
} from "@scout-for-lol/temporal/pipeline-contracts";
import { prisma } from "#src/database/index.ts";
import type { Db } from "#src/database/index.ts";
import {
  getSubjectIntent,
  type UpsertIntentResult,
} from "#src/database/durable/intent-repository.ts";
import {
  getWorkflowStart,
  recordWorkflowStartAccepted,
} from "#src/database/durable/workflow-start-repository.ts";
import type { NotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { resolveNotificationGate } from "#src/temporal/notification/notification-policy.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import { settleNotificationTip } from "#src/temporal/notification/notification-presentation.ts";

/**
 * The V2 notification lane's reads, and the two translations every one of its
 * Activities depends on.
 *
 * `recordDurableWrite` is fail-open by design, for writes that only record an
 * effect decided elsewhere. This lane is the opposite, for the same reason the
 * match core is: the intent row IS the pipeline's memory — it is what decides
 * whether a send may happen at all, and what a resumed run reads to find out
 * whether one already did — so a write that could not be made is an Activity
 * failure to be retried, not a metric to be counted. Every write in this lane
 * therefore goes to the repository directly and reports its answer.
 */

/**
 * One intent, or the honest statement that there is none.
 *
 * `absent` is a legitimate answer here and only here. Every other Activity in
 * the lane is driving an intent it was told exists, so a missing row means a
 * child was started for a decision nobody made — and no retry makes a row
 * appear.
 *
 * The gate travels with the intent so the Workflow learns in one read both
 * where the machine stands and whether it may be moved: a recovery-born
 * intent under a policy that forbids its target is reported `held`, and the
 * Workflow stops there without rendering or minting an attempt.
 */
export async function readNotificationIntent(
  input: {
    stage: ScoutStage;
    intentKey: NotificationIntentKey;
  },
  execution: { workflowId: string; runId: string },
): Promise<ScoutNotificationIntentResult> {
  await acceptNotificationStart(prisma, input, execution);
  const record = await getSubjectIntent(prisma, { intentKey: input.intentKey });
  if (record === null) {
    return { kind: "absent" };
  }
  return ScoutNotificationIntentResultSchema.parse({
    kind: "present",
    intent: intentSummary(record.intent),
    gate: await resolveNotificationGate(record),
  });
}

/** A child reaching its first Activity proves Temporal accepted the handoff. */
export async function acceptNotificationStart(
  db: Db,
  input: { stage: ScoutStage; intentKey: NotificationIntentKey },
  execution: { workflowId: string; runId: string },
): Promise<void> {
  const expectedId = scoutNotificationWorkflowId(input.stage, input.intentKey);
  if (execution.workflowId !== expectedId) {
    throw new Error(
      `Notification start ${execution.workflowId} does not match ${expectedId}`,
    );
  }
  const request = await getWorkflowStart(db, {
    requestedWorkflowId: expectedId,
  });
  if (request === null) return;
  if (request.acceptance !== null) return;
  // A request written before the generation rename carries the old type.
  const notificationTypes = scoutWorkflowTypesOf(
    SCOUT_WORKFLOW_NAMES.notification,
  );
  if (
    !notificationTypes.includes(request.workflowType) ||
    !notificationTypes.includes(request.inputPayload.kind) ||
    !Bun.deepEquals(request.inputPayload.data, input, true)
  ) {
    throw new Error(
      `Notification start ${expectedId} has different requested facts`,
    );
  }
  const result = await recordWorkflowStartAccepted(db, {
    requestId: request.requestId,
    acceptedAt: toIsoInstant(new Date()),
    runId: WorkflowRunIdSchema.parse(execution.runId),
  });
  if (result.outcome === "answered-by-another-run") {
    throw new Error(
      `Notification start ${expectedId} was accepted by another run`,
    );
  }
}

/** One intent in the domain's own state vocabulary, parsed before it travels. */
export function intentSummary(intent: NotificationIntent): ScoutIntentSummary {
  return ScoutIntentSummarySchema.parse({
    intentKey: intent.key,
    state: intent.state,
    attemptCount: intent.attemptCount,
    ...(intent.lastFailure === undefined
      ? {}
      : { lastFailure: intent.lastFailure }),
  });
}

/**
 * The stored intent, or a terminal failure naming what is missing.
 *
 * Non-retryable on purpose: `transitionIntent` already throws for an intent
 * that was never upserted, and turning that into a retried Activity would wedge
 * a notification child behind a row that is never going to arrive.
 */
export async function requireIntentRecord(
  intentKey: NotificationIntentKey,
): Promise<NotificationIntentRecord> {
  const record = await getSubjectIntent(prisma, { intentKey });
  if (record === null) {
    throw ApplicationFailure.nonRetryable(
      `Notification intent ${intentKey} does not exist`,
      "MissingDomainRecord",
    );
  }
  return record;
}

/**
 * A transition answer in the V2 contracts' vocabulary.
 *
 * The domain's `applied` variant carries the whole `next` intent, and
 * `ScoutDurableCommitSchema` is a strict union that would reject it — so this
 * narrows to the outcome before parsing rather than parsing the domain value
 * whole. Everything else passes through untouched, conflict reason included,
 * and the parse is what makes a repository or domain that grows a new reason
 * fail here instead of travelling as a shape the Workflow cannot discriminate.
 */
export function notificationCommit(
  result: NotificationTransitionResult | UpsertIntentResult,
): ScoutDurableCommit {
  return ScoutDurableCommitSchema.parse(
    result.outcome === "applied" ? { outcome: "applied" } : result,
  );
}

/**
 * Report a transition alongside the state it actually left behind.
 *
 * An `applied` result already carries the next intent, so it needs no read.
 * Anything else — `already-applied`, or a conflict — means the row is not what
 * this run assumed, and the only honest state to report is the stored one. A
 * run that reported the state it WANTED would tell the Workflow to keep driving
 * an intent somebody else has already moved.
 */
export async function notificationTransition(
  intentKey: NotificationIntentKey,
  result: NotificationTransitionResult,
): Promise<ScoutNotificationTransitionResult> {
  let intent: NotificationIntent;
  if (result.outcome === "applied") {
    intent = result.next;
  } else {
    const stored = await requireIntentRecord(intentKey);
    intent = stored.intent;
  }
  await prisma.$transaction(async (tx) => {
    await settleNotificationTip(intent, tx);
  });
  return ScoutNotificationTransitionResultSchema.parse({
    commit: notificationCommit(result),
    state: intent.state,
    attemptCount: intent.attemptCount,
  });
}
