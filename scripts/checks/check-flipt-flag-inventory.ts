import type { FlagDeployment } from "../../packages/feature-flags/src/deployments.ts";
import {
  compareDeploymentFlags,
  createFlagsMachineFetcher,
  fetchFlagsDeploymentSnapshot,
  FlagsDeploymentSnapshotSchema,
  formatDeploymentFlagDrift,
  normalizeFlagsBaseUrl,
  selectFlagDeployments,
} from "../../packages/feature-flags/src/flags-drift.ts";
import {
  applyDeclaredDeploymentFlags,
  applyMissingDeploymentFlags,
} from "../../packages/feature-flags/src/flags-reconcile.ts";
import {
  managedFlagInventory,
  managedFlagNamespaces,
} from "../../packages/feature-flags/src/managed-flag-inventory.ts";
import { projectDeploymentFlags } from "../../packages/feature-flags/src/project-deployment.ts";

function argument(
  name: string,
  args: readonly string[] = Bun.argv,
): string | undefined {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index === -1) return undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Explicit ${name} value is required`);
  }
  if (args.lastIndexOf(name) !== index) {
    throw new Error(`Duplicate ${name}`);
  }
  return value;
}

export function declaredRolloutArguments(args: readonly string[]) {
  const plan = args.includes("--plan-declared");
  const apply = args.includes("--apply-declared");
  if (!plan && !apply) {
    if (args.includes("--flag")) {
      throw new Error("--flag requires --plan-declared or --apply-declared");
    }
    return;
  }
  if ((plan && apply) || args.includes("--apply-missing")) {
    throw new Error("Choose exactly one inventory mutation or preview mode");
  }
  const flagKeys = args.flatMap((arg, index) => {
    if (arg !== "--flag") return [];
    const key = args[index + 1];
    if (key === undefined || key.startsWith("--")) {
      throw new Error("--flag requires a key");
    }
    return [key];
  });
  if (flagKeys.length === 0) {
    throw new Error("Explicit --flag selection is required");
  }
  const deploymentFilter = argument("--deployment", args);
  const environmentFilter = argument("--environment", args);
  const namespaceFilter = argument("--namespace", args);
  if (
    deploymentFilter === undefined &&
    (environmentFilter === undefined || namespaceFilter === undefined)
  ) {
    throw new Error(
      "Explicit --deployment or both --environment and --namespace are required",
    );
  }
  const selected = selectFlagDeployments({
    deploymentFilter,
    environmentFilter,
    namespaceFilter,
  });
  const deployment = selected[0];
  if (deployment === undefined || selected.length !== 1) {
    throw new Error("Declared rollout must target exactly one deployment");
  }
  return {
    deployment,
    flagKeys,
    mode: apply ? ("apply" as const) : ("plan" as const),
  };
}

function requiredUrl(): string {
  const url = argument("--url") ?? Bun.env["FLAGS_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error(
      "FLAGS_URL or --url is required; this operator-only check never guesses a Flags endpoint",
    );
  }
  return normalizeFlagsBaseUrl(url);
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

export type DeploymentSnapshotLoader = (
  deployment: FlagDeployment,
) => Promise<unknown>;

export async function checkManagedFlagMatrix(options: {
  deploymentFilter?: string | undefined;
  namespaceFilter?: string | undefined;
  environmentFilter?: string | undefined;
  loadSnapshot: DeploymentSnapshotLoader;
}): Promise<string[]> {
  const deployments = selectFlagDeployments({
    deploymentFilter: options.deploymentFilter,
    environmentFilter: options.environmentFilter,
    namespaceFilter: options.namespaceFilter,
  });
  const messages: string[] = [];
  const failures: string[] = [];
  for (const deployment of deployments) {
    const expectedFlags = projectDeploymentFlags(deployment);
    let parsed: ReturnType<typeof FlagsDeploymentSnapshotSchema.parse>;
    try {
      parsed = FlagsDeploymentSnapshotSchema.parse(
        await options.loadSnapshot(deployment),
      );
      if (parsed.deployment !== deployment.id) {
        throw new Error(
          `snapshot deployment "${parsed.deployment}" did not match "${deployment.id}"`,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(
        `Flags snapshot validation failed in ${deployment.id}: ${detail}`,
      );
      continue;
    }
    const errors = formatDeploymentFlagDrift(
      compareDeploymentFlags(parsed.flags, expectedFlags),
    );
    if (errors.length > 0) {
      failures.push(
        `Flags managed-flag drift detected in ${deployment.id}:\n  - ${errors.join("\n  - ")}`,
      );
      continue;
    }
    messages.push(
      `Flags managed-flag inventory is aligned: ${expectedFlags.length.toString()} keys in ${deployment.id}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Flags managed-flag check failed:\n- ${failures.join("\n- ")}`,
    );
  }
  return messages;
}

function resolveScopeArguments(args: readonly string[] = Bun.argv) {
  const explicitDeployment = argument("--deployment", args);
  const explicitNamespace = argument("--namespace", args);
  const explicitEnvironment = argument("--environment", args);
  if (
    explicitDeployment !== undefined &&
    (explicitNamespace !== undefined || explicitEnvironment !== undefined)
  ) {
    throw new Error(
      "Choose either --deployment or --environment/--namespace filters",
    );
  }
  if (
    explicitDeployment !== undefined ||
    explicitNamespace !== undefined ||
    explicitEnvironment !== undefined
  ) {
    return {
      deploymentFilter: explicitDeployment,
      namespaceFilter: explicitNamespace,
      environmentFilter: explicitEnvironment,
    };
  }
  const ambientDeployment = Bun.env["FLAGS_DEPLOYMENT"];
  if (ambientDeployment !== undefined && ambientDeployment.length > 0) {
    return {
      deploymentFilter: ambientDeployment,
      namespaceFilter: undefined,
      environmentFilter: undefined,
    };
  }
  return {
    deploymentFilter: undefined,
    namespaceFilter: undefined,
    environmentFilter: undefined,
  };
}

async function runDeclaredRollout(
  rollout: NonNullable<ReturnType<typeof declaredRolloutArguments>>,
): Promise<void> {
  const url = requiredUrl();
  const token = Bun.env["FLAGS_MACHINE_TOKEN"];
  const hasToken = token !== undefined && token.trim() !== "";
  const fetcher =
    hasToken || rollout.mode === "apply"
      ? createFlagsMachineFetcher(url, token)
      : undefined;
  const result = await applyDeclaredDeploymentFlags({
    url,
    deployment: rollout.deployment,
    flagKeys: rollout.flagKeys,
    mode: rollout.mode,
    ...(fetcher === undefined ? {} : { fetcher }),
    onPlan: (plan) => {
      if (rollout.mode === "apply") {
        console.error(JSON.stringify({ phase: "preview", ...plan }));
      }
    },
  });
  console.log(
    JSON.stringify(result, null, Bun.argv.includes("--json") ? undefined : 2),
  );
  if (
    result.changes.some(
      (change) => change.status === "conflict" || change.status === "failed",
    )
  ) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const rollout = declaredRolloutArguments(Bun.argv);
  if (rollout !== undefined) {
    await runDeclaredRollout(rollout);
    return;
  }
  const scope = resolveScopeArguments(Bun.argv);
  const deployments = selectFlagDeployments(scope);
  const url = requiredUrl();
  if (Bun.argv.includes("--apply-missing")) {
    const created = await applyMissingDeploymentFlags({
      url,
      fetcher: createFlagsMachineFetcher(url, Bun.env["FLAGS_MACHINE_TOKEN"]),
      deployments,
    });
    for (const result of created) {
      if (result.createdFlags.length === 0) continue;
      console.log(
        `created missing Flags keys in ${result.deployment}: flags=${result.createdFlags.join(",")}`,
      );
    }
  }
  const messages = await checkManagedFlagMatrix({
    ...scope,
    loadSnapshot: (deployment) =>
      fetchFlagsDeploymentSnapshot({ url, deployment }),
  });
  for (const message of messages) {
    console.log(message);
  }
}

if (import.meta.main) await main();
