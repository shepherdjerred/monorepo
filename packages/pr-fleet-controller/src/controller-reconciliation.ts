import type { ControllerTelemetry } from "./controller-telemetry.ts";
import { buildPrState, classify, type RefreshedPr } from "./fleet-logic.ts";
import type { FleetStore } from "./state.ts";

export function closeMissingPrStates(
  openNumbers: ReadonlySet<number>,
  changes: string[],
  dependencies: {
    store: FleetStore;
    telemetry: ControllerTelemetry;
  },
): void {
  const { store, telemetry } = dependencies;
  for (const [number, previous] of store.prs) {
    if (openNumbers.has(number) || previous.status === "closed") {
      continue;
    }
    const request = store.operatorRequests.get(number);
    if (request !== undefined) {
      telemetry.operatorQuestionSuperseded(request, "PR closed");
      store.operatorRequests.delete(number);
    }
    store.completedRestacks.delete(number);
    store.activeRestacks.delete(number);
    store.prs.set(number, {
      ...previous,
      status: "closed",
      runtimeAgent: null,
    });
    if (store.activeWorkers.has(number)) {
      store.cancelledWorkers.add(number);
      store.workerControllers.get(number)?.abort();
    } else {
      store.releaseLeases(number);
      store.workerControllers.delete(number);
    }
    changes.push(`PR #${String(number)} closed or merged`);
  }
}

export function reconcilePrStates(
  refreshed: RefreshedPr[],
  changes: string[],
  dependencies: {
    store: FleetStore;
    telemetry: ControllerTelemetry;
    model: string;
  },
): void {
  const { store, telemetry, model } = dependencies;
  for (const item of refreshed) {
    const previous = store.prs.get(item.identity.number);
    let operatorRequest = store.operatorRequests.get(item.identity.number);
    if (
      operatorRequest !== undefined &&
      (operatorRequest.headSha !== item.identity.headSha ||
        classify(item.identity, item.evidence, false) === "green")
    ) {
      const headChanged = operatorRequest.headSha !== item.identity.headSha;
      const reason = headChanged ? "PR head changed" : "PR became green";
      telemetry.operatorQuestionSuperseded(operatorRequest, reason);
      store.operatorRequests.delete(item.identity.number);
      operatorRequest = undefined;
      changes.push(
        `superseded operator request for PR #${String(item.identity.number)}: ${reason}`,
      );
    }
    const reconciled = buildPrState(item, {
      previous,
      pausedReason: store.pausedReasons.get(item.identity.number),
      model,
      operatorRequest: operatorRequest ?? null,
    });
    store.prs.set(item.identity.number, reconciled.state);
    const headChanged =
      previous !== undefined &&
      previous.identity.headSha !== reconciled.state.identity.headSha;
    if (headChanged || reconciled.state.classification === "green") {
      store.completedRestacks.delete(item.identity.number);
      store.activeRestacks.delete(item.identity.number);
    }
    if (
      (headChanged || reconciled.state.classification === "green") &&
      store.activeWorkers.has(item.identity.number)
    ) {
      store.cancelledWorkers.add(item.identity.number);
      store.workerControllers.get(item.identity.number)?.abort();
    }
    if (reconciled.change !== null) {
      changes.push(reconciled.change);
    }
  }
}
