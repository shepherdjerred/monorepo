import { applyMissingManagedFlags } from "../../packages/feature-flags/src/flipt-missing-flag-apply.ts";
import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
  FliptSnapshotSchema,
  formatManagedFlagDrift,
} from "../../packages/feature-flags/src/managed-flag-drift.ts";
import {
  managedFlagInventory,
  managedFlagNamespaces,
  materializeManagedNamespaceEnvironment,
} from "../../packages/feature-flags/src/managed-flag-inventory.ts";

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  const value = Bun.argv[index + 1];
  return index !== -1 && value !== undefined ? value : undefined;
}

function requiredUrl(): string {
  const url = argument("--url") ?? Bun.env["FLIPT_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error(
      "FLIPT_URL or --url is required; this operator-only check never guesses a Flipt endpoint",
    );
  }
  return url.replace(/\/$/u, "");
}

export function selectedManagedEnvironments(
  environmentFilter: string | undefined,
): string[] {
  const keys = managedFlagInventory.environments.map(
    (environment) => environment.key,
  );
  if (environmentFilter === undefined) return keys;
  if (!keys.includes(environmentFilter)) {
    throw new Error(`unknown managed environment filter: ${environmentFilter}`);
  }
  return [environmentFilter];
}

export function selectedManagedNamespaces(
  namespaceFilter: string | undefined,
): string[] {
  if (namespaceFilter === undefined) return managedFlagNamespaces;
  if (!managedFlagNamespaces.includes(namespaceFilter)) {
    throw new Error(`unknown managed namespace filter: ${namespaceFilter}`);
  }
  return [namespaceFilter];
}

export type SnapshotLoader = (
  environment: string,
  namespace: string,
) => Promise<unknown>;

export async function checkManagedFlagMatrix(options: {
  namespaceFilter?: string | undefined;
  environmentFilter?: string | undefined;
  loadSnapshot: SnapshotLoader;
}): Promise<string[]> {
  const messages: string[] = [];
  const failures: string[] = [];
  for (const environment of selectedManagedEnvironments(
    options.environmentFilter,
  )) {
    for (const namespace of selectedManagedNamespaces(
      options.namespaceFilter,
    )) {
      const expectedFlags = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        environment,
        namespace,
      );
      let snapshot: Awaited<ReturnType<typeof fetchFliptSnapshot>>;
      try {
        snapshot = FliptSnapshotSchema.parse(
          await options.loadSnapshot(environment, namespace),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(
          `Flipt snapshot validation failed in ${environment}/${namespace}: ${detail}`,
        );
        continue;
      }
      const errors = formatManagedFlagDrift(
        compareManagedFlagInventory(snapshot, expectedFlags),
      );
      if (errors.length > 0) {
        failures.push(
          `Flipt managed-flag drift detected in ${environment}/${namespace}:\n  - ${errors.join("\n  - ")}`,
        );
        continue;
      }
      messages.push(
        `Flipt managed-flag inventory is aligned: ${expectedFlags.length.toString()} keys in ${environment}/${namespace}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Flipt managed-flag matrix check failed:\n- ${failures.join("\n- ")}`,
    );
  }
  return messages;
}

async function main(): Promise<void> {
  const namespaceFilter = argument("--namespace") ?? Bun.env["FLIPT_NAMESPACE"];
  const environmentFilter =
    argument("--environment") ?? Bun.env["FLIPT_ENVIRONMENT"];
  const url = requiredUrl();
  if (Bun.argv.includes("--apply-missing")) {
    const created = await applyMissingManagedFlags({
      url,
      ...(environmentFilter === undefined ? {} : { environmentFilter }),
      ...(namespaceFilter === undefined ? {} : { namespaceFilter }),
    });
    for (const result of created) {
      if (
        result.createdFlags.length === 0 &&
        result.createdSegments.length === 0 &&
        result.createdNamespaces.length === 0
      ) {
        continue;
      }
      const namespaces = result.createdNamespaces.join(",") || "none";
      const segments = result.createdSegments.join(",") || "none";
      const flags = result.createdFlags.join(",") || "none";
      console.log(
        `created missing Flipt resources in ${result.environment}/${result.namespace}: namespaces=${namespaces} segments=${segments} flags=${flags}`,
      );
    }
  }
  const messages = await checkManagedFlagMatrix({
    namespaceFilter,
    environmentFilter,
    loadSnapshot: (environment, selectedNamespace) =>
      fetchFliptSnapshot({ url, namespace: selectedNamespace, environment }),
  });
  for (const message of messages) {
    console.log(message);
  }
}

if (import.meta.main) await main();
