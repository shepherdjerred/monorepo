import {
  ActivityCancellationType,
  proxyActivities,
  type ActivityOptions,
} from "@temporalio/workflow";
import type { RetryPolicy } from "@temporalio/common";
import type {
  ScoutTemporalActivities,
  ScoutTemporalV2Activities,
} from "#src/activities.ts";
import type { ScoutStage } from "#src/contracts.ts";
import { DETACHED_WORK_MAX_ATTEMPTS } from "#src/contracts.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";

const NON_RETRYABLE_FAILURES = [
  "InvalidSavedQuery",
  "MissingDomainRecord",
  "StaleRevision",
  "DisabledReport",
  "AuthorizationFailure",
  "ProviderQuotaExhausted",
] as const;

export const BACKGROUND_ACTIVITY_RETRY_POLICY = {
  maximumAttempts: DETACHED_WORK_MAX_ATTEMPTS,
  initialInterval: "10 seconds",
  backoffCoefficient: 2,
  maximumInterval: "5 minutes",
  nonRetryableErrorTypes: [...NON_RETRYABLE_FAILURES],
} satisfies RetryPolicy;

/**
 * One queue class's budget, minus the queue it is spent on.
 *
 * A queue class gets a named object exactly when two proxies share it: v1 and
 * V2 both dispatch to `scout-{stage}-realtime`, and workers there serve both,
 * so "V2 mirrors its v1 sibling" has to be one object rather than two copies
 * that agree today. `interactiveActivities` keeps its options inline because
 * nothing else spends that budget.
 */
type QueueActivityOptions = Omit<ActivityOptions, "taskQueue">;

export const REALTIME_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "90 seconds",
  scheduleToCloseTimeout: "5 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    maximumAttempts: 5,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    nonRetryableErrorTypes: [...NON_RETRYABLE_FAILURES],
  },
} satisfies QueueActivityOptions;

export const BACKGROUND_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "30 minutes",
  scheduleToCloseTimeout: "2 hours",
  heartbeatTimeout: "30 seconds",
  retry: BACKGROUND_ACTIVITY_RETRY_POLICY,
} satisfies QueueActivityOptions;

export const LAKE_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "2 hours",
  scheduleToCloseTimeout: "6 hours",
  heartbeatTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
    nonRetryableErrorTypes: [...NON_RETRYABLE_FAILURES],
  },
} satisfies QueueActivityOptions;

export function realtimeActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).realtime,
    ...REALTIME_ACTIVITY_OPTIONS,
  });
}

export function backgroundActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).background,
    ...BACKGROUND_ACTIVITY_OPTIONS,
  });
}

export function interactiveActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).interactive,
    startToCloseTimeout: "30 minutes",
    scheduleToCloseTimeout: "35 minutes",
    heartbeatTimeout: "10 seconds",
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      maximumAttempts: 2,
      initialInterval: "5 seconds",
      backoffCoefficient: 2,
      maximumInterval: "15 seconds",
      nonRetryableErrorTypes: [
        ...NON_RETRYABLE_FAILURES,
        "AmbiguousProviderAttempt",
      ],
    },
  });
}

export function lakeActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).lake,
    ...LAKE_ACTIVITY_OPTIONS,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// V2 durable pipeline
// ───────────────────────────────────────────────────────────────────────────

export function realtimeV2Activities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalV2Activities>({
    taskQueue: scoutTaskQueues(stage).realtime,
    ...REALTIME_ACTIVITY_OPTIONS,
  });
}

export function backgroundV2Activities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalV2Activities>({
    taskQueue: scoutTaskQueues(stage).background,
    ...BACKGROUND_ACTIVITY_OPTIONS,
  });
}

export function lakeV2Activities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalV2Activities>({
    taskQueue: scoutTaskQueues(stage).lake,
    ...LAKE_ACTIVITY_OPTIONS,
  });
}

/**
 * The one V2 deviation from the sibling options, and the reason it exists.
 *
 * `deliverNotificationV2` is the single Activity whose retry is itself the
 * hazard: the request may have reached Discord and posted a message before
 * the response was lost, so a second attempt can double-deliver to a user.
 * `maximumAttempts: 1` makes an ambiguous send terminate as one attempt, which
 * the Workflow then records as `unknown-delivery` against that attempt's
 * nonce — the domain's deliberate dead end, left only by an operator who
 * looked. Retrying here would trade a visible stall for an invisible
 * duplicate.
 *
 * `WAIT_CANCELLATION_COMPLETED` closes the same hole from the other side: a
 * cancelled Workflow must not walk away from a send whose outcome is still
 * unobserved. The timeouts are Discord's, not the shared realtime budget — a
 * send that has not answered in 30 seconds is already ambiguous, and waiting
 * out the 5-minute realtime window only widens the window in which the
 * Workflow cannot say what happened.
 */
export const NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "30 seconds",
  scheduleToCloseTimeout: "2 minutes",
  heartbeatTimeout: "10 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 1,
    nonRetryableErrorTypes: [...NON_RETRYABLE_FAILURES],
  },
} satisfies QueueActivityOptions;

export function notificationDeliveryV2Activities(stage: ScoutStage) {
  return proxyActivities<
    Pick<ScoutTemporalV2Activities, "deliverNotificationV2">
  >({
    taskQueue: scoutTaskQueues(stage).realtime,
    ...NOTIFICATION_DELIVERY_ACTIVITY_OPTIONS,
  });
}
