const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export const REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS = 2 * MINUTE_MS;

// `initialInterval` is deliberately a full minute rather than a few seconds:
// the send lease below can only be taken over once it has outlived an
// abandoned owner, and the first retry is what has to reach that age. A
// shorter first delay makes every remaining attempt land inside the lease,
// throw on contention, and exhaust the budget — losing the report entirely.
// `reportDeliveryRetrySchedule` plus its unit test hold that relationship.
export const REPORT_DELIVERY_ACTIVITY_RETRY = {
  maximumAttempts: 3,
  initialInterval: MINUTE_MS,
  backoffCoefficient: 2,
  maximumInterval: MINUTE_MS,
} as const;

/**
 * Delays Temporal waits between consecutive attempts, capped by
 * `maximumInterval` exactly as the server applies it.
 */
export function reportDeliveryRetrySchedule(): number[] {
  const {
    maximumAttempts,
    initialInterval,
    backoffCoefficient,
    maximumInterval,
  } = REPORT_DELIVERY_ACTIVITY_RETRY;
  return Array.from({ length: maximumAttempts - 1 }, (_unused, index) =>
    Math.min(initialInterval * backoffCoefficient ** index, maximumInterval),
  );
}

// A delivery attempt owns the Postal send for one start-to-close window. Past
// that, Temporal has abandoned it and may dispatch another, so the lease must
// outlive the window or a takeover could race an owner Temporal would still
// accept a completion from. It must not outlive it by more than the retry
// schedule can wait out, or a dead owner suppresses the report forever.
export const REPORT_SEND_CLAIM_TAKEOVER_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS + MINUTE_MS;

/**
 * When the first attempt holds the lease until Temporal abandons it, this is
 * when the second attempt starts. It must be at or after
 * `REPORT_SEND_CLAIM_TAKEOVER_MS` for the takeover path to be reachable.
 */
export const REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS +
  (reportDeliveryRetrySchedule()[0] ?? 0);

// Every attempt running its full window, plus the real (capped) delays between
// them.
export const REPORT_DELIVERY_WORKFLOW_BUDGET_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS *
    REPORT_DELIVERY_ACTIVITY_RETRY.maximumAttempts +
  reportDeliveryRetrySchedule().reduce((total, delay) => total + delay, 0);

// Includes Temporal workflow start/result propagation margin beyond the full
// delegated retry budget. Both replay-compatible and current email activities
// use this bound because both synchronously await core delivery.
export const AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS = 10 * MINUTE_MS;
