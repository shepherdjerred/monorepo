import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import type { FlagMetricsRecorder } from "@shepherdjerred/feature-flags/observability.ts";

/**
 * Starts the flag provider. A `false` evaluation is an answer, not an
 * outage. Provider outages use the declared feature default; missing keys
 * and malformed successful responses fail loudly.
 */
export async function initBrainFlags(
  onInitializationFailure: (message: string) => void,
  metrics: FlagMetricsRecorder,
): Promise<void> {
  await initFeatureFlags({ onInitializationFailure, metrics });
}

export async function shutdownBrainFlags(): Promise<void> {
  await shutdownFeatureFlags();
}
