import { combineFailures } from "./cli-failures.ts";
import { ControllerStopError } from "./controller-stop-error.ts";
import type { ControllerTelemetry } from "./controller-telemetry.ts";
import type { FleetSnapshot } from "./schemas.ts";
import type { FleetStore } from "./state.ts";
import { settleAllOrThrow } from "./terminal-loop.ts";

type ControllerShutdownOptions = {
  begin: () => void;
  abortActiveWorkers: () => void;
  activeWorkerCount: () => number;
  inFlightTick: Promise<unknown> | null;
  workerSettlements: () => Iterable<Promise<unknown>>;
  externalSettlement: Promise<unknown>;
  snapshot: () => FleetSnapshot;
  telemetry: ControllerTelemetry;
};

export function abortFleetWorkers(store: FleetStore): void {
  for (const [prNumber, controller] of store.workerControllers) {
    store.cancelledWorkers.add(prNumber);
    controller.abort();
  }
}

export async function settleControllerShutdown(
  options: ControllerShutdownOptions,
): Promise<FleetSnapshot> {
  options.begin();
  options.abortActiveWorkers();
  let failure: Error | undefined;
  if (options.inFlightTick !== null) {
    try {
      await options.inFlightTick;
    } catch (error) {
      failure = combineFailures(failure, error);
    }
  }
  // A tick already inside dispatch may create a worker after the first abort.
  options.abortActiveWorkers();

  let shutdownStarted = false;
  try {
    options.telemetry.shutdownStarted(options.activeWorkerCount());
    shutdownStarted = true;
  } catch (error) {
    failure = combineFailures(failure, error);
  }
  try {
    await settleAllOrThrow([
      ...options.workerSettlements(),
      options.externalSettlement,
    ]);
  } catch (error) {
    failure = combineFailures(failure, error);
  }
  const snapshot = options.snapshot();
  if (shutdownStarted) {
    try {
      options.telemetry.shutdownCompleted(snapshot);
    } catch (error) {
      failure = combineFailures(failure, error);
    }
  }
  if (failure !== undefined) {
    throw new ControllerStopError(snapshot, failure);
  }
  return snapshot;
}
