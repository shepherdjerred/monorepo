import {
  createAlertmanagerPoster,
  type AlertmanagerAlert,
} from "#lib/alertmanager.ts";
import {
  flagInventoryMetrics,
  type createFlagInventoryMetrics,
} from "#observability/metrics-flags.ts";
import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import {
  createFlagsMachineFetcher,
  describeFlagValueDrift,
  fetchFlagsDeploymentDocument,
  fetchFlagsDiff,
  type FlagsHttpFetcher,
} from "@shepherdjerred/feature-flags/flags-drift.ts";
import {
  applyMissingDeploymentFlags,
  applyRetiredDeploymentFlags,
} from "@shepherdjerred/feature-flags/flags-reconcile.ts";
import {
  buildFliptFlagDriftAlert,
  type FliptFlagDriftAlertInput,
} from "#shared/alerts/flipt-flag-drift-alert.ts";

export type FliptFlagInventoryResult = FliptFlagDriftAlertInput & {
  readonly revision: number;
  readonly observedAt: string;
  readonly createdFlags: readonly string[];
  readonly retiredFlags: readonly string[];
};

function requiredEnvironment(
  name: string,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the Flags inventory reconciler`);
  }
  return value;
}

export type ReconcileFlagsInventoryOptions = {
  readonly url: string;
  readonly token: string;
  readonly alertmanagerUrl: string;
  readonly deployments?: readonly FlagDeployment[];
  readonly upstreamFetch?: FlagsHttpFetcher;
  readonly metrics?: ReturnType<typeof createFlagInventoryMetrics>;
  readonly postAlerts?: (alerts: readonly AlertmanagerAlert[]) => Promise<void>;
  readonly now?: () => Date;
};

export async function reconcileFlagsInventory(
  options: ReconcileFlagsInventoryOptions,
): Promise<FliptFlagInventoryResult[]> {
  const deployments = options.deployments ?? flagDeployments;
  const metrics = options.metrics ?? flagInventoryMetrics;
  const clock = options.now ?? (() => new Date());
  const fetcher = createFlagsMachineFetcher(
    options.url,
    options.token,
    options.upstreamFetch,
  );
  const observedTime = clock();
  const observedAt = observedTime.toISOString();

  const retired = await applyRetiredDeploymentFlags({
    url: options.url,
    fetcher,
    deployments,
  });
  const retiredByDeployment = new Map(
    retired.map((entry) => [entry.deployment, entry.retiredFlags]),
  );

  const created = await applyMissingDeploymentFlags({
    url: options.url,
    fetcher,
    deployments,
  });
  const createdByDeployment = new Map(
    created.map((entry) => [entry.deployment, entry.createdFlags]),
  );

  const diff = await fetchFlagsDiff({ url: options.url, fetcher });
  const diffByDeployment = new Map(
    diff.deployments.map((entry) => [entry.id, entry]),
  );

  const results = await Promise.all(
    deployments.map(async (deployment) => {
      const deploymentDiff = diffByDeployment.get(deployment.id);
      if (deploymentDiff === undefined) {
        throw new Error(
          `Flags diff response omitted deployment ${deployment.id}`,
        );
      }
      const document = await fetchFlagsDeploymentDocument({
        url: options.url,
        deployment,
        fetcher,
      });
      metrics.observeDeployment(deployment, document.flags, observedTime);
      return {
        deployment: deployment.id,
        namespace: deployment.catalog,
        environment: deployment.fliptEnvironment,
        revision: document.revision,
        missingFlags: deploymentDiff.missing.map((flag) => flag.key),
        extraFlags: deploymentDiff.extra,
        contractMismatches: deploymentDiff.drift.flatMap((entry) =>
          describeFlagValueDrift(entry.declared, entry.live),
        ),
        createdFlags: createdByDeployment.get(deployment.id) ?? [],
        retiredFlags: retiredByDeployment.get(deployment.id) ?? [],
        observedAt,
      };
    }),
  );

  const alertTime = clock();
  const poster =
    options.postAlerts ?? createAlertmanagerPoster(options.alertmanagerUrl);
  await poster(
    results.map((result) => buildFliptFlagDriftAlert(result, alertTime)),
  );
  return results;
}

export type FliptFlagInventoryActivities = typeof fliptFlagInventoryActivities;

export const fliptFlagInventoryActivities = {
  async checkFliptFlagInventory(): Promise<FliptFlagInventoryResult[]> {
    return reconcileFlagsInventory({
      url: requiredEnvironment("FLAGS_URL"),
      token: requiredEnvironment("FLAGS_MACHINE_TOKEN"),
      alertmanagerUrl: requiredEnvironment("ALERTMANAGER_URL"),
    });
  },
};
