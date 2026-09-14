import {
  initializeLocalVoiceModels,
  loadSpokenFeedbackClips,
  type LocalVoiceModels,
  type SpokenFeedbackClips,
} from "@shepherdjerred/voice-assistant";
import configuration, {
  type VoiceAssistantConfig,
} from "#src/configuration.ts";
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

/**
 * Why a join could not be served, when it could not.
 *
 * `unconfigured` and `failed` are deliberately distinct: the first is a
 * deployment that was never meant to serve voice (no Realtime credential) and
 * is not a fault, the second is a deployment that was and could not, which is.
 * Collapsing them would hide a broken asset set behind a benign-looking
 * message.
 */
export type VoiceRuntimeStatus = "ready" | "unconfigured" | "failed";

let runtime: VoiceAssistantRuntime | null = null;
let inFlight: Promise<VoiceRuntimeStatus> | null = null;

/** Resolve the direct development credential or the live Kubernetes Secret projection. */
export async function resolveVoiceCredential(
  config: VoiceAssistantConfig,
): Promise<string | undefined> {
  if (config.openAiApiKey !== undefined) return config.openAiApiKey;
  if (config.openAiApiKeyFile === undefined) return undefined;

  const credentialFile = Bun.file(config.openAiApiKeyFile);
  if (!(await credentialFile.exists())) return undefined;
  const rawCredential = await credentialFile.text();
  const credential = rawCredential.trim();
  return credential === "" ? undefined : credential;
}

async function loadRuntime(): Promise<VoiceRuntimeStatus> {
  const config = configuration.voiceAssistant;
  const openAiApiKey = await resolveVoiceCredential(config);
  if (openAiApiKey === undefined) {
    logger.info(
      "🔇 Voice assistant not configured in this deployment (no OpenAI credential)",
    );
    return "unconfigured";
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
  // Anything that throws between here and the assignment below owns these
  // models and must release them: the loader is retryable, so a leak here
  // would strand a whole native/WASM model set on every subsequent join until
  // the process runs out of memory.
  let feedbackClips;
  try {
    feedbackClips = await loadSpokenFeedbackClips(
      config.assetsDir,
      VOICE_FEEDBACK_CLIP_FILES,
    );
  } catch (error: unknown) {
    await models.close();
    throw error;
  }
  runtime = { models, feedbackClips, openAiApiKey };
  logger.info("✅ Voice assistant models verified", {
    kwsRuntime: models.runtime,
  });
  return "ready";
}

/**
 * Load the voice pipeline on first use, once per process.
 *
 * Activation is the `voice_assistant_enabled` Flipt flag, evaluated per guild
 * at the call site; this function answers the separate question of whether
 * this deployment can serve a session at all. Loading here rather than at boot
 * is what makes that flag meaningful — a boot-time gate only takes effect on
 * the next pod restart, and the models are useless weight in a process no
 * guild has enabled.
 *
 * Failures are reported, never fatal. A pod that cannot load its models still
 * serves reports, commands and the web surface; only voice is unavailable, and
 * it says so. The in-flight promise is shared so concurrent joins load once,
 * and is cleared on failure so a later join retries rather than pinning the
 * process to a transient error.
 */
export async function ensureVoiceAssistantRuntime(): Promise<VoiceRuntimeStatus> {
  if (runtime !== null) return "ready";
  inFlight ??= loadRuntime();
  try {
    const status = await inFlight;
    // Keep the memo only for a usable runtime; anything else must be
    // re-attempted, since the fix (a credential, a corrected asset mount) can
    // arrive without a restart.
    if (status !== "ready") inFlight = null;
    return status;
  } catch (error: unknown) {
    inFlight = null;
    logger.error("❌ Voice assistant models failed to load", { error });
    return "failed";
  }
}

/** Null until a session has successfully loaded the pipeline in this process. */
export function getVoiceAssistantRuntime(): VoiceAssistantRuntime | null {
  return runtime;
}

/** Test-only: install or clear a fake runtime. */
export function setVoiceAssistantRuntimeForTests(
  value: VoiceAssistantRuntime | null,
): void {
  runtime = value;
  inFlight = null;
}
