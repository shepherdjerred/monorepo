import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
  FliptSnapshotSchema,
  formatManagedFlagDrift,
} from "../packages/feature-flags/src/managed-flag-drift.ts";
import {
  managedFlagInventory,
  materializeManagedEnvironment,
} from "../packages/feature-flags/src/managed-flag-inventory.ts";

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

export type SnapshotLoader = (
  namespace: string,
  environment: string,
) => Promise<unknown>;

export async function checkManagedEnvironments(options: {
  namespace: string;
  environmentFilter?: string | undefined;
  loadSnapshot: SnapshotLoader;
}): Promise<string[]> {
  const messages: string[] = [];
  for (const environment of selectedManagedEnvironments(
    options.environmentFilter,
  )) {
    const expectedFlags = materializeManagedEnvironment(
      managedFlagInventory,
      environment,
    );
    let snapshot: Awaited<ReturnType<typeof fetchFliptSnapshot>>;
    try {
      snapshot = FliptSnapshotSchema.parse(
        await options.loadSnapshot(options.namespace, environment),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Flipt snapshot validation failed in ${options.namespace}/${environment}: ${detail}`,
        { cause: error },
      );
    }
    const errors = formatManagedFlagDrift(
      compareManagedFlagInventory(snapshot, expectedFlags),
    );
    if (errors.length > 0) {
      throw new Error(
        `Flipt managed-flag drift detected in ${options.namespace}/${environment}:\n- ${errors.join("\n- ")}`,
      );
    }
    messages.push(
      `Flipt managed-flag inventory is aligned: ${expectedFlags.length.toString()} keys in ${options.namespace}/${environment}`,
    );
  }
  return messages;
}

async function main(): Promise<void> {
  const namespace =
    argument("--namespace") ??
    Bun.env["FLIPT_NAMESPACE"] ??
    managedFlagInventory.namespace;
  const environmentFilter =
    argument("--environment") ?? Bun.env["FLIPT_ENVIRONMENT"];
  const url = requiredUrl();
  const messages = await checkManagedEnvironments({
    namespace,
    environmentFilter,
    loadSnapshot: (selectedNamespace, environment) =>
      fetchFliptSnapshot({ url, namespace: selectedNamespace, environment }),
  });
  for (const message of messages) {
    console.log(message);
  }
}

if (import.meta.main) await main();
