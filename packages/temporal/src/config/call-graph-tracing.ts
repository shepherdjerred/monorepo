import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createStructuredLogger } from "#observability/logging.ts";

const FLAG_KEY = "temporal-call-graph-tracing";
const log = createStructuredLogger("config.call-graph-tracing");

export async function initializeCallGraphTracing(options: {
  readonly environment: string;
  readonly workerRole: string;
}): Promise<boolean> {
  await initFeatureFlags({
    onInitializationFailure: (message) => {
      log("warning", message);
    },
  });
  const result = await isEnabled(FLAG_KEY, {
    default: false,
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
