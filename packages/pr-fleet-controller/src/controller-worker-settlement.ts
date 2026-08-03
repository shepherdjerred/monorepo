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
};

export function settleWorkerResult(settlement: WorkerSettlement): boolean {
  const { store, telemetry, observer, dispatched, prNumber, result } =
    settlement;
  telemetry.workerCompleted(prNumber, dispatched, result);
  store.activeWorkers.delete(prNumber);
  store.workerControllers.delete(prNumber);
  store.cancelledWorkers.delete(prNumber);
  store.releaseLeases(prNumber);
  const current = store.prs.get(prNumber);
  if (current === undefined) {
    return false;
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
