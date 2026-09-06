import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import { applyMissingManagedFlags } from "@shepherdjerred/feature-flags/flipt-missing-flag-apply.ts";
import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
} from "@shepherdjerred/feature-flags/managed-flag-drift.ts";
import {
  managedFlagInventory,
  managedFlagNamespaces,
  materializeManagedNamespaceEnvironment,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  buildFliptFlagDriftAlert,
  type FliptFlagDriftAlertInput,
} from "#shared/alerts/flipt-flag-drift-alert.ts";

export type FliptFlagInventoryResult = FliptFlagDriftAlertInput & {
  readonly observedAt: string;
  readonly createdFlags: readonly string[];
  readonly createdSegments: readonly string[];
};

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the Flipt inventory check`);
  }
  return value;
}

export type FliptFlagInventoryActivities = typeof fliptFlagInventoryActivities;

export const fliptFlagInventoryActivities = {
  async checkFliptFlagInventory(): Promise<FliptFlagInventoryResult[]> {
    const url = requiredEnvironment("FLIPT_URL");
    const observedAt = new Date().toISOString();
    const created = await applyMissingManagedFlags({ url });
    const createdByPair = new Map(
      created.map((result) => [
        `${result.environment}/${result.namespace}`,
        result,
      ]),
    );
    const results = await Promise.all(
      managedFlagInventory.environments.flatMap((environment) =>
        managedFlagNamespaces.map(async (namespace) => {
          const expectedFlags = materializeManagedNamespaceEnvironment(
            managedFlagInventory,
            environment.key,
            namespace,
          );
          const snapshot = await fetchFliptSnapshot({
            url,
            namespace,
            environment: environment.key,
          });
          const drift = compareManagedFlagInventory(snapshot, expectedFlags);
          const applied = createdByPair.get(`${environment.key}/${namespace}`);
          return {
            namespace,
            environment: environment.key,
            missingInFlipt: drift.missingInFlipt,
            undeclaredInInventory: drift.undeclaredInInventory,
            contractMismatches: drift.contractMismatches,
            createdFlags: applied?.createdFlags ?? [],
            createdSegments: applied?.createdSegments ?? [],
            observedAt,
          };
        }),
      ),
    );
    const alertTime = new Date();
    await createAlertmanagerPoster(requiredEnvironment("ALERTMANAGER_URL"))(
      results.map((result) => buildFliptFlagDriftAlert(result, alertTime)),
    );
    return results;
  },
};
