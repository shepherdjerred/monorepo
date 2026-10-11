import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";

/**
 * Starts the flag provider. A `false` evaluation is an answer, not an
 * outage: unknown or unreachable flags resolve to the default (off) and the
 * gated flow reports disabled.
 */
export async function initBrainFlags(
  onInitializationFailure: (message: string) => void,
): Promise<void> {
  await initFeatureFlags({ onInitializationFailure });
}

export async function shutdownBrainFlags(): Promise<void> {
  await shutdownFeatureFlags();
}
