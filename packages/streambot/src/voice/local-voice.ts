import {
  initializeLocalVoiceModels as initializeVoiceAssistantModels,
  initializeLocalVoiceModelsForRuntime as initializeVoiceAssistantModelsForRuntime,
  validateVoiceAssets as validateVoiceAssistantAssets,
  type LocalVoiceModels,
} from "@shepherdjerred/voice-assistant/local-models.ts";
import type { VoiceAudioLifecycleOptions } from "@shepherdjerred/voice-assistant/audio/audio-lifecycle-types.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  streambotVoiceAssetManifest,
  VOICE_FRAGMENT_TAIL_MS,
} from "@shepherdjerred/streambot/voice/constants.ts";
import {
  streambotVoiceLifecycleMetrics,
  streambotVoiceObservability,
} from "@shepherdjerred/streambot/observability/voice-metrics-ports.ts";

/**
 * Streambot's bindings over the shared voice pipeline's phrase-agnostic model loader: every
 * entry point below closes over the hey-streambot asset manifest, and the voice `enabled` gate
 * stays here — the package always initializes when asked.
 */

export async function validateVoiceAssets(assetsDir: string) {
  return await validateVoiceAssistantAssets(
    streambotVoiceAssetManifest(assetsDir),
  );
}

export async function initializeLocalVoiceModelsForRuntime(
  assetsDir: string,
  runtime: "native" | "wasm",
): Promise<LocalVoiceModels> {
  return await initializeVoiceAssistantModelsForRuntime(
    streambotVoiceAssetManifest(assetsDir),
    runtime,
  );
}

/** Load and smoke-test the selected in-process local runtime. Null when voice is disabled. */
export async function initializeLocalVoiceModels(
  config: Config["voice"],
): Promise<LocalVoiceModels | null> {
  if (!config.enabled) return null;
  return await initializeVoiceAssistantModels(
    streambotVoiceAssetManifest(config.assetsDir),
    config.runtime,
    logger.child("voice-models"),
  );
}

/** The injected lifecycle ports every streambot-owned VoiceAudioLifecycle shares. */
export function streambotVoiceLifecycleDeps(): Pick<
  VoiceAudioLifecycleOptions,
  "fragmentTailMs" | "metrics" | "observability"
> {
  return {
    fragmentTailMs: VOICE_FRAGMENT_TAIL_MS,
    metrics: streambotVoiceLifecycleMetrics,
    observability: streambotVoiceObservability("voice-lifecycle"),
  };
}
