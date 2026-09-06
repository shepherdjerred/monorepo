import {
  initializeLocalVoiceModels,
  loadSpokenFeedbackClips,
  type LocalVoiceModels,
  type SpokenFeedbackClips,
} from "@shepherdjerred/voice-assistant";
import configuration from "#src/configuration.ts";
import {
  scoutVoiceAssetManifest,
  VOICE_FEEDBACK_CLIP_FILES,
} from "#src/voice-assistant/constants.ts";
import { scoutVoiceObservability } from "#src/voice-assistant/metrics-ports.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("voice-runtime");

export type VoiceAssistantRuntime = {
  readonly models: LocalVoiceModels;
  readonly feedbackClips: SpokenFeedbackClips;
  readonly openAiApiKey: string;
};

let runtime: VoiceAssistantRuntime | null = null;

/**
 * Env-gated fatal bootstrap, run between champion-asset validation and the
 * Discord gateway start. `VOICE_ASSISTANT_ENABLED=false` (the default) loads
 * nothing — no model file is even stat'ed. When enabled, every failure is
 * fatal on purpose: SHA-pinned asset verification, the keyword runtime smoke
 * test, and the feedback clips are one packaging contract, and a pod that
 * cannot verify them must not come up half-deaf. The enabled gate lives here,
 * never in Flipt — unauthenticated Flipt must not control audio capture.
 */
export async function bootstrapVoiceAssistant(): Promise<void> {
  const config = configuration.voiceAssistant;
  if (!config.enabled) {
    logger.info("🔇 Voice assistant disabled (VOICE_ASSISTANT_ENABLED unset)");
    return;
  }
  if (config.openAiApiKey === undefined) {
    // configuration.ts already refuses this combination; repeated here so the
    // invariant holds even if bootstrap order ever changes.
    throw new Error("Voice assistant enabled without OPENAI_API_KEY");
  }
  logger.info("🎙️ Loading voice assistant models", {
    assetsDir: config.assetsDir,
    runtime: config.kwsRuntime,
  });
  const models = await initializeLocalVoiceModels(
    scoutVoiceAssetManifest(config.assetsDir),
    config.kwsRuntime,
    scoutVoiceObservability("voice-models").logger,
  );
  const feedbackClips = await loadSpokenFeedbackClips(
    config.assetsDir,
    VOICE_FEEDBACK_CLIP_FILES,
  );
  runtime = { models, feedbackClips, openAiApiKey: config.openAiApiKey };
  logger.info("✅ Voice assistant models verified", {
    kwsRuntime: models.runtime,
  });
}

/** Null whenever the deployment is not voice-enabled; callers answer users accordingly. */
export function getVoiceAssistantRuntime(): VoiceAssistantRuntime | null {
  return runtime;
}

/** Test-only: install or clear a fake runtime. */
export function setVoiceAssistantRuntimeForTests(
  value: VoiceAssistantRuntime | null,
): void {
  runtime = value;
}
