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

/** A lone failure is re-thrown as-is so callers keep their `instanceof`
 * checks; a non-Error throw is wrapped rather than re-thrown raw. */
function asMaintenanceError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
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
