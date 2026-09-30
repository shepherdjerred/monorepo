import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";

/** Chat classification flow. Default off; the plugin fails closed without it. */
export const CLASSIFY_FLAG = "storm-brain-classify-enabled";

/** Ticket triage flow. Default off; untriaged tickets stay in the queue. */
export const TRIAGE_FLAG = "storm-brain-triage-enabled";

export type FlowFlags = {
  classifyEnabled: () => Promise<boolean>;
  triageEnabled: () => Promise<boolean>;
};

/**
 * Starts the flag provider. A `false` evaluation is an answer, not an
 * outage: unknown or unreachable flags resolve to the default (off) and the
 * flows report disabled.
 */
export async function initBrainFlags(
  onInitializationFailure: (message: string) => void,
): Promise<void> {
  await initFeatureFlags({ onInitializationFailure });
}

export async function shutdownBrainFlags(): Promise<void> {
  await shutdownFeatureFlags();
}

export function createFlowFlags(): FlowFlags {
  return {
    classifyEnabled: () => enabled(CLASSIFY_FLAG),
    triageEnabled: () => enabled(TRIAGE_FLAG),
  };
}

async function enabled(
  key: typeof CLASSIFY_FLAG | typeof TRIAGE_FLAG,
): Promise<boolean> {
  const result = await isEnabled(key, {
    default: false,
    targetingKey: "storm-brain",
  });
  return result.value;
}
