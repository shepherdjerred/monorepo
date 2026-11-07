import { applyMissingManagedFlags } from "../../packages/feature-flags/src/flipt-missing-flag-apply.ts";
import { applyDeclaredManagedFlags } from "../../packages/feature-flags/src/flipt-declared-flag-apply.ts";
import { createFliptOperatorFetcher } from "../../packages/feature-flags/src/flipt-operator-fetcher.ts";
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

export function declaredRolloutArguments(args: readonly string[]) {
  const plan = args.includes("--plan-declared");
  const apply = args.includes("--apply-declared");
  if (!plan && !apply) {
    if (args.includes("--flag"))
      throw new Error("--flag requires --plan-declared or --apply-declared");
    return;
  }
  if ((plan && apply) || args.includes("--apply-missing"))
    throw new Error("Choose exactly one inventory mutation or preview mode");
  const value = (name: string) => {
    const index = args.indexOf(name);
    const next = args[index + 1];
    if (next === undefined || index === -1 || next.startsWith("--"))
      throw new Error(`Explicit ${name} is required`);
    if (args.lastIndexOf(name) !== index) throw new Error(`Duplicate ${name}`);
    return next;
  };
  const flagKeys = args.flatMap((arg, index) => {
    if (arg !== "--flag") return [];
    const key = args[index + 1];
    if (key === undefined || key.startsWith("--"))
      throw new Error("--flag requires a key");
    return [key];
  });
  if (flagKeys.length === 0)
    throw new Error("Explicit --flag selection is required");
  return {
    environment: value("--environment"),
    namespace: value("--namespace"),
    flagKeys,
    mode: apply ? ("apply" as const) : ("plan" as const),
  };
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

async function runDeclaredRollout(
  rollout: NonNullable<ReturnType<typeof declaredRolloutArguments>>,
): Promise<void> {
  const url = requiredUrl();
  const result = await applyDeclaredManagedFlags({
    ...rollout,
    url,
    fetcher: createFliptOperatorFetcher(url, Bun.env["FLIPT_OPERATOR_TOKEN"]),
    onPlan: (plan) => {
      if (rollout.mode === "apply")
        console.error(JSON.stringify({ phase: "preview", ...plan }));
    },
  });
  console.log(
    JSON.stringify(result, null, Bun.argv.includes("--json") ? undefined : 2),
  );
  if (
    result.changes.some(
      (change) => change.status === "conflict" || change.status === "failed",
    )
  )
    process.exitCode = 1;
}

async function main(): Promise<void> {
  const rollout = declaredRolloutArguments(Bun.argv);
  if (rollout !== undefined) {
    await runDeclaredRollout(rollout);
    return;
  }
  const namespaceFilter = argument("--namespace") ?? Bun.env["FLIPT_NAMESPACE"];
  const environmentFilter =
    argument("--environment") ?? Bun.env["FLIPT_ENVIRONMENT"];
  const url = requiredUrl();
  if (Bun.argv.includes("--apply-missing")) {
    const created = await applyMissingManagedFlags({
      url,
      fetcher: createFliptOperatorFetcher(url, Bun.env["FLIPT_OPERATOR_TOKEN"]),
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
