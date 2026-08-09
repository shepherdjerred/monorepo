import type { FleetEnvironment } from "./ports.ts";
import type { PrIdentity } from "./schemas.ts";
import {
  computeStackIds,
  mapBounded,
  type RefreshedPr,
} from "./fleet-logic.ts";
import { withPrCommandCorrelation } from "./controller-correlation.ts";
import type { FleetStore } from "./state.ts";

export class PrHeadChangedDuringRefreshError extends Error {
  readonly prNumber: number;
  readonly expectedHead: string;
  readonly actualHead: string;

  constructor(prNumber: number, expectedHead: string, actualHead: string) {
    super(
      `PR #${String(prNumber)} changed during evidence refresh (${expectedHead} -> ${actualHead})`,
    );
    this.name = "PrHeadChangedDuringRefreshError";
    this.prNumber = prNumber;
    this.expectedHead = expectedHead;
    this.actualHead = actualHead;
  }
}

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
