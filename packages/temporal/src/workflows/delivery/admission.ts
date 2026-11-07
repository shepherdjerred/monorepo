import { workflowInfo } from "@temporalio/workflow";

/**
 * A deployment waiting to be claimed (a pause, or another release holding
 * its target or the dispatch barrier) continues as a new run instead of
 * growing one history without bound: a 30-second wait adds about 11 events,
 * and a two-day wait reached 43k events and timed out its workflow tasks.
 * Nothing is claimed while waiting, so the next run starts the same wait.
 * Histories recorded before this keep waiting in one run.
 */
export const DELIVERY_WAIT_ROLLOVER_PATCH = "delivery-wait-rollover-v1";

/** About four hours of waiting per run, unless the server suggests sooner. */
export const DELIVERY_WAIT_ROLLOVER_ITERATIONS = 500;

/** Whether an admission wait that has waited `waits` times should continue as new. */
export function admissionRolloverDue(waits: number): boolean {
  return (
    waits >= DELIVERY_WAIT_ROLLOVER_ITERATIONS ||
    workflowInfo().continueAsNewSuggested
  );
}
