import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
} from "@shepherdjerred/feature-flags/managed-flag-drift.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  buildFliptFlagDriftAlert,
  type FliptFlagDriftAlertInput,
} from "#shared/flipt-flag-drift-alert.ts";

export type FliptFlagInventoryResult = FliptFlagDriftAlertInput & {
  readonly observedAt: string;
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
  async checkFliptFlagInventory(): Promise<FliptFlagInventoryResult> {
    const snapshot = await fetchFliptSnapshot({
      url: requiredEnvironment("FLIPT_URL"),
      namespace: managedFlagInventory.namespace,
      environment: managedFlagInventory.environment,
    });
    const drift = compareManagedFlagInventory(snapshot);
    const result: FliptFlagInventoryResult = {
      namespace: managedFlagInventory.namespace,
      environment: managedFlagInventory.environment,
      missingInFlipt: drift.missingInFlipt,
      undeclaredInInventory: drift.undeclaredInInventory,
      observedAt: new Date().toISOString(),
    };
    await createAlertmanagerPoster(requiredEnvironment("ALERTMANAGER_URL"))([
      buildFliptFlagDriftAlert(result, new Date()),
    ]);
    return result;
  },
};
