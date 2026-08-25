import type { FleetEnvironment } from "#domain/ports.ts";
import type { PrIdentity } from "#domain/schemas.ts";
import {
  computeStackIds,
  mapBounded,
  type RefreshedPr,
} from "#domain/fleet-logic.ts";
import { withPrCommandCorrelation } from "./correlation.ts";
import type { FleetStore } from "#domain/state.ts";
import { PrHeadChangedDuringRefreshError } from "#domain/errors.ts";

export function deferPrAfterHeadChange(
  store: FleetStore,
  error: PrHeadChangedDuringRefreshError,
): void {
  const stale = store.prs.get(error.prNumber);
  if (stale === undefined) {
    return;
  }
  store.prs.set(error.prNumber, {
    ...stale,
    classification: "pending",
    status: "waiting-ci",
  });
  if (store.activeWorkers.has(error.prNumber)) {
    store.cancelledWorkers.add(error.prNumber);
    store.workerControllers.get(error.prNumber)?.abort();
  }
}

export async function refreshFleetEvidence(options: {
  identities: PrIdentity[];
  environment: FleetEnvironment;
  changes: string[];
  onHeadChanged: (error: PrHeadChangedDuringRefreshError) => void;
}): Promise<RefreshedPr[]> {
  const { identities, environment, changes, onHeadChanged } = options;
  const stackIds = computeStackIds(identities);
  const candidates = await mapBounded(identities, 5, (identity) =>
    withPrCommandCorrelation(identity, async () => {
      try {
        return {
          identity,
          evidence: await environment.refreshEvidence(identity),
          stackId:
            stackIds.get(identity.number) ?? `pr-${String(identity.number)}`,
        };
      } catch (error) {
        if (!(error instanceof PrHeadChangedDuringRefreshError)) throw error;
        changes.push(
          `deferred PR #${String(error.prNumber)}: head changed during evidence refresh (${error.expectedHead} -> ${error.actualHead})`,
        );
        onHeadChanged(error);
        return null;
      }
    }),
  );
  return candidates.filter((candidate) => candidate !== null);
}
