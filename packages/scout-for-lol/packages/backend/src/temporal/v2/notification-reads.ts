import { ApplicationFailure } from "@temporalio/common";
import type { NotificationIntentKey } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import type { NotificationTransitionResult } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  ScoutIntentSummaryV2Schema,
  ScoutNotificationIntentV2ResultSchema,
  ScoutNotificationTransitionV2ResultSchema,
  type ScoutIntentSummaryV2,
  type ScoutNotificationIntentV2Result,
  type ScoutNotificationTransitionV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import {
  ScoutDurableCommitV2Schema,
  type ScoutDurableCommitV2,
} from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import {
  getIntent,
  type UpsertIntentResult,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { resolveNotificationGateV2 } from "#src/temporal/v2/notification/notification-policy.ts";

/**
 * The V2 notification lane's reads, and the two translations every one of its
 * Activities depends on.
 *
 * v1's delivery recorder writes through `recordDurableWrite`, which is
 * fail-open by design: a recorder that cannot reach its tables must never
 * block an authoritative send. V2 inverts that, for the same reason the match
 * core does. Here the intent row IS the pipeline's memory — it is what decides
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
export async function readNotificationIntentV2(input: {
  intentKey: NotificationIntentKey;
}): Promise<ScoutNotificationIntentV2Result> {
  const record = await getIntent(prisma, { intentKey: input.intentKey });
  if (record === null) {
    return { kind: "absent" };
  }
  return ScoutNotificationIntentV2ResultSchema.parse({
    kind: "present",
    intent: intentSummaryV2(record.intent),
    gate: await resolveNotificationGateV2(record),
  });
}

/** One intent in the domain's own state vocabulary, parsed before it travels. */
export function intentSummaryV2(
  intent: NotificationIntent,
): ScoutIntentSummaryV2 {
  return ScoutIntentSummaryV2Schema.parse({
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
export async function requireIntentRecordV2(
  intentKey: NotificationIntentKey,
): Promise<MatchNotificationIntentRecord> {
  const record = await getIntent(prisma, { intentKey });
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
 * `ScoutDurableCommitV2Schema` is a strict union that would reject it — so this
 * narrows to the outcome before parsing rather than parsing the domain value
 * whole. Everything else passes through untouched, conflict reason included,
 * and the parse is what makes a repository or domain that grows a new reason
 * fail here instead of travelling as a shape the Workflow cannot discriminate.
 */
export function notificationCommitV2(
  result: NotificationTransitionResult | UpsertIntentResult,
): ScoutDurableCommitV2 {
  return ScoutDurableCommitV2Schema.parse(
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
export async function notificationTransitionV2(
  intentKey: NotificationIntentKey,
  result: NotificationTransitionResult,
): Promise<ScoutNotificationTransitionV2Result> {
  let intent: NotificationIntent;
  if (result.outcome === "applied") {
    intent = result.next;
  } else {
    const stored = await requireIntentRecordV2(intentKey);
    intent = stored.intent;
  }
  return ScoutNotificationTransitionV2ResultSchema.parse({
    commit: notificationCommitV2(result),
    state: intent.state,
    attemptCount: intent.attemptCount,
  });
}
