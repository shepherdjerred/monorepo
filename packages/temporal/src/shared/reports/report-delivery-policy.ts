const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export const REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS = 2 * MINUTE_MS;

// `initialInterval` is deliberately long rather than a few seconds: the send
// lease below can only be taken over once it has outlived an abandoned owner,
// and the first retry is what has to reach that age. A shorter first delay
// makes every remaining attempt land inside the lease, throw on contention,
// and exhaust the budget — losing the report entirely, which is the failure
// the lease exists to prevent. `reportDeliverySendLeaseBounds` and its unit
// test hold that relationship.
export const REPORT_DELIVERY_ACTIVITY_RETRY = {
  maximumAttempts: 3,
  initialInterval: 90 * SECOND_MS,
  backoffCoefficient: 2,
  maximumInterval: 2 * MINUTE_MS,
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

// The lease is timestamped and aged against ONE clock: the start of the
// activity attempt that holds it, captured before any I/O. Timestamping at
// claim-write time instead would let slow pre-claim reads backdate the lease
// relative to the attempt, so a retry could see a lease as unexpired long
// after its owner died — the stranded-report failure again, just triggered by
// slow storage rather than by short retries.

// An attempt must not still be talking to Postal when someone else may take
// its lease, so the send is abandoned this long after the attempt started.
// Measured from attempt start rather than from the call, because slow
// pre-send work would otherwise push the deadline past the takeover point.
export const REPORT_SEND_DEADLINE_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS;

// A lease older than this may be taken over. It must exceed both bounds
// above: start-to-close, so a takeover cannot race an attempt Temporal would
// still accept a completion from, and the send deadline, so no request from
// the previous owner can still be in flight.
export const REPORT_SEND_CLAIM_TAKEOVER_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS + MINUTE_MS;

/**
 * When the first attempt claims the lease and then hangs until Temporal
 * abandons it, this is when the next attempt starts — and therefore the age
 * the lease has reached by the time anyone can next evaluate it.
 */
export const REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS =
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS +
  (reportDeliveryRetrySchedule()[0] ?? 0);

/**
 * What the owner has left, after its last possible send, to record the
 * delivery before its lease becomes takeable. Recording cannot be fenced into
 * the send itself, so this window is the only thing that keeps a successful
 * send and its receipt on the same side of a takeover.
 */
export const REPORT_SEND_PERSIST_BUDGET_MS =
  REPORT_SEND_CLAIM_TAKEOVER_MS - REPORT_SEND_DEADLINE_MS;

/**
 * The bounds a reviewer actually has to check, in one place. `safeBy` is the
 * margin by which a takeover trails the previous owner's last possible
 * outbound request; `reachableBy` is the margin by which the first retry
 * outlives the lease. Both must stay positive.
 */
export function reportDeliverySendLeaseBounds(): {
  safeBy: number;
  reachableBy: number;
} {
  return {
    safeBy: REPORT_SEND_CLAIM_TAKEOVER_MS - REPORT_SEND_DEADLINE_MS,
    reachableBy:
      REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS - REPORT_SEND_CLAIM_TAKEOVER_MS,
  };
}

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
