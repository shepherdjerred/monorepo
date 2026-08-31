import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { RetryPolicy } from "@temporalio/common";
import type { ScoutTemporalActivities } from "#src/activities.ts";
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

export function realtimeActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).realtime,
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
  });
}

export function backgroundActivities(stage: ScoutStage) {
  return proxyActivities<ScoutTemporalActivities>({
    taskQueue: scoutTaskQueues(stage).background,
    startToCloseTimeout: "30 minutes",
    scheduleToCloseTimeout: "2 hours",
    heartbeatTimeout: "30 seconds",
    retry: BACKGROUND_ACTIVITY_RETRY_POLICY,
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
  });
}
