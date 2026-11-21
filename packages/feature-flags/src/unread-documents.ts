import { flagDeploymentForSelector } from "./deployments.ts";
import { managedFlagInventory } from "./managed-flag-inventory.ts";

export type UnreadFlagDocument = {
  readonly catalog: string;
  readonly fliptEnvironment: string;
};

/**
 * Inventory namespace and environment pairs that no workload reads.
 * Seeding imports a pair only when a deployment names it.
 */
export function unreadFlagDocuments(): UnreadFlagDocument[] {
  return managedFlagInventory.environments.flatMap((environment) =>
    managedFlagInventory.namespaces.flatMap((namespace) =>
      flagDeploymentForSelector(namespace.key, environment.key) === undefined
        ? [
            {
              catalog: namespace.key,
              fliptEnvironment: environment.key,
            },
          ]
        : [],
    ),
  );
}
