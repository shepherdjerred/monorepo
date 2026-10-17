import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createStructuredLogger } from "#observability/logging.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { featureFlagMetrics } from "#observability/metrics-flags.ts";
import {
  loadFeatureFlagConfiguration,
  type Environment,
} from "@shepherdjerred/feature-flags/config/load.ts";

const FLAG_KEY = "temporal-call-graph-tracing";
const log = createStructuredLogger("config.call-graph-tracing");

export function callGraphTracingDefault(
  bootstrap: Environment,
  workloadEnvironment: string,
): boolean {
  const configuration = loadFeatureFlagConfiguration(bootstrap);
  const environment =
    configuration.mode === "flipt"
      ? configuration.environment
      : workloadEnvironment === "prod" || workloadEnvironment === "production"
        ? "prod"
        : "beta";
  return managedBooleanDefault(FLAG_KEY, environment);
}

export async function initializeCallGraphTracing(options: {
  readonly environment: string;
  readonly workerRole: string;
}): Promise<boolean> {
  await initFeatureFlags({
    metrics: featureFlagMetrics,
    onInitializationFailure: (message) => {
      log("warning", message);
    },
  });
  if (
    options.workerRole === "media-network" ||
    options.workerRole === "media-files"
  )
    return false;
  const result = await isEnabled(FLAG_KEY, {
    default: callGraphTracingDefault(Bun.env, options.environment),
    targetingKey: `temporal-worker-${options.workerRole}`,
    attributes: {
      environment: options.environment,
      worker_role: options.workerRole,
    },
  });
  log("info", "Temporal call-graph tracing boot decision resolved", {
    enabled: result.value,
    reason: result.reason,
    errorCode: result.errorCode,
  });
  return result.value;
}

export async function shutdownCallGraphTracing(): Promise<void> {
  await shutdownFeatureFlags();
}
