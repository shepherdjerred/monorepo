/**
 * Image build gate for the baked hey-scout voice assets.
 *
 * Runs inside the `voice-smoke` Docker stage as the non-root deploy uid, so a
 * build cannot publish an image whose models only load as root. It exercises
 * exactly what `bootstrapVoiceAssistant` does at pod startup — SHA-pinned asset
 * verification, the keyword runtime smoke, the wake-verifier smoke, and the
 * spoken feedback clips — under BOTH keyword runtimes, because production
 * resolves `VOICE_KWS_RUNTIME=auto` to whichever one loads and a wasm-only
 * fallback must be a deliberate choice rather than an unnoticed regression.
 *
 * It deliberately does not go through `src/configuration.ts`: that schema
 * demands the full service surface (Discord token, database URL, version), none
 * of which exists at build time, and the packaging contract under test is the
 * asset directory alone.
 */
import { initializeLocalVoiceModelsForRuntime } from "@shepherdjerred/voice-assistant/local-models.ts";
import { loadSpokenFeedbackClips } from "@shepherdjerred/voice-assistant";
import {
  scoutVoiceAssetManifest,
  VOICE_FEEDBACK_CLIP_FILES,
} from "#src/voice-assistant/constants.ts";

const assetsDir = Bun.env["VOICE_ASSETS_DIR"] ?? "/opt/scout/voice";
const manifest = scoutVoiceAssetManifest(assetsDir);

for (const runtime of ["native", "wasm"] as const) {
  const models = await initializeLocalVoiceModelsForRuntime(manifest, runtime);
  process.stdout.write(`voice model smoke passed (${models.runtime})\n`);
  await models.close();
}

// Not part of the asset manifest, but `bootstrapVoiceAssistant` loads these and
// treats a missing or malformed clip as fatal — so the build gate must too.
await loadSpokenFeedbackClips(assetsDir, VOICE_FEEDBACK_CLIP_FILES);
process.stdout.write("spoken feedback clips loaded\n");
