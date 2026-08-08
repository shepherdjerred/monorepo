import type { ControllerTelemetry } from "./controller-telemetry.ts";
import { currentTimestamp } from "./fleet-logic.ts";
import type { FleetObserver } from "./ports.ts";
import type { PrState, WorkerResult } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

type WorkerSettlement = {
  store: FleetStore;
  telemetry: ControllerTelemetry;
  observer: FleetObserver;
  dispatched: PrState | undefined;
  prNumber: number;
  result: WorkerResult;
  tickId: string | undefined;
};

export function settleWorkerResult(settlement: WorkerSettlement): boolean {
  const { store, telemetry, observer, dispatched, prNumber, result, tickId } =
    settlement;
  telemetry.workerCompleted(prNumber, dispatched, result, tickId);
  store.activeWorkers.delete(prNumber);
  store.workerControllers.delete(prNumber);
  store.cancelledWorkers.delete(prNumber);
  store.releaseLeases(prNumber);
  const current = store.prs.get(prNumber);
  if (current === undefined) {
    return false;
  }
  const operatorRequest = store.operatorRequests.get(prNumber);
  if (operatorRequest !== undefined) {
    if (
      result.operatorRequestId != null &&
      result.operatorRequestId !== operatorRequest.id
    ) {
      throw new Error(
        `Worker returned operator request ${result.operatorRequestId}, but ${operatorRequest.id} is pending`,
      );
    }
    store.prs.set(prNumber, {
      ...current,
      runtimeAgent: null,
      status: "waiting-for-answer",
      classification: "waiting-for-answer",
      lastAgentReportAt: currentTimestamp(),
      lastProgressAt: currentTimestamp(),
      noProgressTicks: 0,
      escalation: null,
      operatorRequest,
    });
    observer.onChange(
      `worker for PR #${String(prNumber)} is waiting for operator request ${operatorRequest.id}`,
    );
    return true;
  }
  if (result.state === "waiting-for-answer") {
    throw new Error(
      `Worker returned waiting-for-answer without registering an operator request`,
    );
  }
  const needsLease =
    result.state === "needs-setup-lease" ||
    result.state === "needs-heavy-lease" ||
    result.state === "needs-write-lease";
  if (needsLease) {
    store.prs.set(prNumber, {
      ...current,
      runtimeAgent: null,
      status: "queued",
      classification: "queued",
      lastAgentReportAt: currentTimestamp(),
    });
    observer.onChange(
      `worker for PR #${String(prNumber)} deferred: ${result.state} — awaiting lease`,
    );
    return false;
  }
  const paused = result.state === "escalation" || result.state === "blocked";
  if (paused) {
    store.pausedReasons.set(prNumber, result.blockers.join("; "));
  }
  store.prs.set(prNumber, {
    ...current,
    runtimeAgent: null,
    status: paused
      ? "paused"
      : result.state === "pushed"
        ? "waiting-ci"
        : current.status,
    classification: paused ? "paused" : current.classification,
    lastAgentReportAt: currentTimestamp(),
    lastProgressAt: currentTimestamp(),
    noProgressTicks: 0,
    escalation: paused ? result.blockers.join("; ") : null,
  });
  observer.onChange(
    `worker for PR #${String(prNumber)}: ${result.state} — ${result.lastAction}`,
  );
  return true;
}

type WorkerFailureSettlement = {
  store: FleetStore;
  telemetry: ControllerTelemetry;
  observer: FleetObserver;
  dispatched: PrState | undefined;
  prNumber: number;
  error: unknown;
  tickId: string | undefined;
  pause: (reason: string) => void;
};

export function settleWorkerFailure(
  settlement: WorkerFailureSettlement,
): boolean {
  const { store, telemetry, observer, dispatched, prNumber, error, tickId } =
    settlement;
  const deliberatelyCancelled = store.cancelledWorkers.has(prNumber);
  if (deliberatelyCancelled) {
    telemetry.workerCancelled(prNumber, dispatched, error, tickId);
  } else {
    telemetry.workerFailed(prNumber, dispatched, error, tickId);
  }
  store.cancelledWorkers.delete(prNumber);
  store.activeWorkers.delete(prNumber);
  store.workerControllers.delete(prNumber);
  store.releaseLeases(prNumber);
  const operatorRequest = store.operatorRequests.get(prNumber);
  if (operatorRequest !== undefined) {
    const current = store.prs.get(prNumber);
    if (current !== undefined) {
      store.prs.set(prNumber, {
        ...current,
        runtimeAgent: null,
        status: "waiting-for-answer",
        classification: "waiting-for-answer",
        lastAgentReportAt: currentTimestamp(),
        lastProgressAt: currentTimestamp(),
        noProgressTicks: 0,
        escalation: null,
        operatorRequest,
      });
    }
    observer.onChange(
      `worker for PR #${String(prNumber)} stopped after requesting operator input`,
    );
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (deliberatelyCancelled) {
    observer.onChange(
      `worker for PR #${String(prNumber)} cancelled (stale head or resolved)`,
    );
    return true;
  }
  const state = store.prs.get(prNumber);
  if (
    store.stopping ||
    state?.status === "closed" ||
    store.pausedReasons.has(prNumber)
  ) {
    observer.onChange(`worker for PR #${String(prNumber)} stopped: ${message}`);
    return false;
  }
  settlement.pause(`worker failed: ${message}`);
  observer.onChange(`worker for PR #${String(prNumber)} failed: ${message}`);
  return false;
}
