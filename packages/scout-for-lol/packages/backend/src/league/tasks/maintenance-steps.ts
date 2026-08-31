import { createLogger } from "#src/logger.ts";

const logger = createLogger("tasks-maintenance-steps");

/**
 * One independently-purposed unit of maintenance work inside a polling task.
 *
 * Data-coupled calls (a sweep and the message refresh that consumes its
 * result) belong in ONE step; unrelated clocks belong in separate ones.
 */
export type MaintenanceStep = {
  /** Stable identifier used in the failure log and the aggregate message. */
  name: string;
  run: () => Promise<void>;
};

/**
 * Run every step even when an earlier one throws, then re-throw.
 *
 * The pre-match and post-match tasks each drive several unrelated clocks in a
 * fixed order, and Bryan Bucks dare refunds are the LAST of them. Running the
 * list as one straight-line `await` chain therefore made a persistently
 * failing earlier step (Riot's API, a dead Discord channel, a broken parlay
 * row) starve those refunds indefinitely: money stayed escrowed because an
 * unrelated subsystem was down.
 *
 * Isolation is per-step, not per-task: the collected failures are re-thrown as
 * an `AggregateError` (a single failure is re-thrown as-is) so the Temporal
 * activity wrapping the task still fails and still retries. Swallowing here
 * would hide a real outage, which is the opposite of what the isolation is
 * for.
 */
/** A lone failure is re-thrown as-is so callers keep their `instanceof`
 * checks; a non-Error throw is wrapped rather than re-thrown raw. */
function asMaintenanceError(error: unknown, message: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(message, { cause: error });
}

export async function runMaintenanceSteps(
  taskName: string,
  steps: readonly MaintenanceStep[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push(error);
      logger.error(
        `❌ ${taskName} step "${step.name}" failed; continuing with the remaining steps:`,
        error,
      );
    }
  }
  if (failures.length === 0) {
    return;
  }
  if (failures.length === 1) {
    throw asMaintenanceError(failures[0], `A ${taskName} step failed`);
  }
  throw new AggregateError(
    failures,
    `${failures.length.toString()} ${taskName} steps failed`,
  );
}
