import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import type { FlagMetricsRecorder } from "@shepherdjerred/feature-flags/observability.ts";
import type { EnvMap } from "./config.ts";

export type StormStatsFlagsInitInput = {
  readonly env?: EnvMap;
  readonly mode: string;
  readonly metrics?: FlagMetricsRecorder;
  readonly provider?: InitFeatureFlagsOptions["provider"];
};

/**
 * Initializes OpenFeature / Flags evaluation when `mode !== "disabled"`.
 * When disabled, skips remote initialization so local dev, tests, and image
 * smoke runs use deterministic env/default fallbacks without network timeouts.
 */
export async function initStormStatsFlags(
  input: StormStatsFlagsInitInput,
): Promise<boolean> {
  if (input.mode === "disabled") {
    return false;
  }
  await initFeatureFlags({
    environment: input.env ?? Bun.env,
    ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    onInitializationFailure: (message) => {
      console.warn(
        JSON.stringify({
          message: "storm_stats_flags_init_failed",
          service: "storm-stats",
          error: message,
        }),
      );
    },
  });
  return true;
}

export async function shutdownStormStatsFlags(): Promise<void> {
  await shutdownFeatureFlags();
}
