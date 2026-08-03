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
  initialFailure: Error | undefined;
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
  let failure = options.initialFailure;
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
  if (!shutdownStarted) {
    try {
      // A one-shot start-write failure must not suppress the final snapshot.
      // Re-establish the lifecycle after settlement so shutdown.failed can
      // durably close it with the state that will also reach the summary.
      options.telemetry.shutdownStarted(options.activeWorkerCount());
      shutdownStarted = true;
    } catch (error) {
      failure = combineFailures(failure, error);
    }
  }
  if (shutdownStarted) {
    try {
      if (failure === undefined) {
        options.telemetry.shutdownCompleted(snapshot);
      } else {
        options.telemetry.shutdownFailed(snapshot, failure);
      }
    } catch (error) {
      failure = combineFailures(failure, error);
    }
  }
  if (failure !== undefined) {
    throw new ControllerStopError(snapshot, failure);
  }
  return snapshot;
}
