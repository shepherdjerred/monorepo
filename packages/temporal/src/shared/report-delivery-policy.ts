const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export const REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS = 2 * MINUTE_MS;
export const REPORT_DELIVERY_ACTIVITY_RETRY = {
  maximumAttempts: 3,
  initialInterval: 10 * SECOND_MS,
  backoffCoefficient: 2,
  maximumInterval: MINUTE_MS,
} as const;

// A delivery attempt owns the Postal send for at most one start-to-close
// window: past that, Temporal has already abandoned the attempt and may have
// dispatched another. Doubling it keeps the lease strictly longer than any
// attempt Temporal will still accept a completion from, so a takeover cannot
// race a live owner, while staying inside the workflow budget below — a third
// attempt reaches this age and delivers a report whose first owner died before
// sending.
export const REPORT_SEND_CLAIM_TAKEOVER_MS =
  2 * REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS;

// Three two-minute attempts plus the 10s and 20s retry delays.
export const REPORT_DELIVERY_WORKFLOW_BUDGET_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS *
    REPORT_DELIVERY_ACTIVITY_RETRY.maximumAttempts +
  REPORT_DELIVERY_ACTIVITY_RETRY.initialInterval +
  REPORT_DELIVERY_ACTIVITY_RETRY.initialInterval *
    REPORT_DELIVERY_ACTIVITY_RETRY.backoffCoefficient;

// Includes Temporal workflow start/result propagation margin beyond the full
// delegated retry budget. Both replay-compatible and current email activities
// use this bound because both synchronously await core delivery.
export const AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS = 10 * MINUTE_MS;
