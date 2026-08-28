import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
  formatManagedFlagDrift,
} from "../packages/feature-flags/src/managed-flag-drift.ts";
import { managedFlagInventory } from "../packages/feature-flags/src/managed-flag-inventory.ts";

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
  return url.replace(/\/$/, "");
}

async function main(): Promise<void> {
  const namespace =
    argument("--namespace") ??
    Bun.env["FLIPT_NAMESPACE"] ??
    managedFlagInventory.namespace;
  const environment =
    argument("--environment") ??
    Bun.env["FLIPT_ENVIRONMENT"] ??
    managedFlagInventory.environment;
  const snapshot = await fetchFliptSnapshot({
    url: requiredUrl(),
    namespace,
    environment,
  });
  const errors = formatManagedFlagDrift(compareManagedFlagInventory(snapshot));
  if (errors.length > 0) {
    throw new Error(
      `Flipt managed-flag drift detected:\n- ${errors.join("\n- ")}`,
    );
  }
  console.log(
    `Flipt managed-flag inventory is aligned: ${managedFlagInventory.flags.length.toString()} keys in ${namespace}/${environment}`,
  );
}

await main();
