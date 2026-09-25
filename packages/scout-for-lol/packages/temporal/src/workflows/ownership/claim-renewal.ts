import type { Duration } from "@temporalio/common";
import { condition } from "@temporalio/workflow";

/**
 * Wait for the work an ownership claim covers, renewing the claim until that
 * work settles.
 *
 * A durable claim goes stale after a fixed bound, and the work it covers can
 * outlive that bound. Another run could then take the claim over and start
 * the same work while this run is still doing it. Renewing from here, where
 * the owner's liveness is known, keeps the claim live exactly as long as its
 * owner is. A terminated Workflow stops renewing, so the bound still frees a
 * claim nothing is using.
 *
 * The command sequence is fixed and shared by every ownership router: one
 * `condition` timer per interval, then the renewal Activity when the timer
 * fires first. Changing it changes the history of every Workflow that calls
 * this, so treat it as part of each caller's replay contract.
 */
export async function awaitWhileRenewing<T>(
  result: Promise<T>,
  interval: Duration,
  renew: () => Promise<void>,
): Promise<T> {
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown }
    | undefined;
  // Records the work's outcome instead of rejecting, so work that fails while
  // the loop is waiting is never an unhandled rejection.
  const settle = async (): Promise<void> => {
    try {
      outcome = { ok: true, value: await result };
    } catch (error) {
      outcome = { ok: false, error };
    }
  };
  const settling = settle();
  while (!(await condition(() => outcome !== undefined, interval))) {
    await renew();
  }
  await settling;
  if (outcome === undefined) {
    throw new Error("The claimed work settled without recording an outcome");
  }
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}
