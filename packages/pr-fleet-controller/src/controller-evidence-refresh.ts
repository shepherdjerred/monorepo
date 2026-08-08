import type { FleetEnvironment } from "./ports.ts";
import type { PrIdentity } from "./schemas.ts";
import {
  computeStackIds,
  mapBounded,
  type RefreshedPr,
} from "./fleet-logic.ts";
import { withPrCommandCorrelation } from "./controller-correlation.ts";

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

export async function refreshFleetEvidence(options: {
  identities: PrIdentity[];
  environment: FleetEnvironment;
  changes: string[];
  onHeadChanged: () => void;
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
        onHeadChanged();
        return null;
      }
    }),
  );
  return candidates.filter((candidate) => candidate !== null);
}
