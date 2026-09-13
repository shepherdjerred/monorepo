import type { VoiceAssetManifest } from "@shepherdjerred/voice-assistant";

/**
 * Fixed identifiers and the hey-scout asset packaging contract. These are
 * deliberately constants, not configuration: the wake phrase is encoded in the
 * trained keyword/verifier assets, and the model/voice pair has exactly one
 * supported value (streambot's "config theater" rationale). The only
 * environment surface is bootstrap: enabled/key/assetsDir/runtime in
 * `src/configuration.ts`.
 */

export const VOICE_REALTIME_MODEL = "gpt-realtime-2.1";
export const VOICE_ASSISTANT_VOICE = "marin";

/**
 * Rolling pre-roll retained before a sherpa candidate. Matches the shared
 * pipeline's `VOICE_WAKE_WINDOW_MS` (asserted by test) — the verifier scores
 * the last two seconds it is handed, so the pre-roll must cover them.
 */
export const VOICE_PRE_ROLL_MS = 2000;
export const VOICE_MAX_UTTERANCE_MS = 15_000;
export const VOICE_TRANSACTION_TIMEOUT_MS = 30_000;

/** A session with no accepted wake for this long leaves the channel. */
export const VOICE_INACTIVITY_TIMEOUT_MS = 45 * 60_000;

/**
 * Milliseconds of audio still to come after each matched keyword fragment ends
 * before "hey scout" is complete. One contract with `hey-scout.txt`: a
 * fragment sherpa can emit that is missing here throws at candidate time.
 * `HEY`'s tail is a pre-training estimate ("scout" is one short syllable);
 * re-measure it against the trained assets with the M2 corpus method before
 * beta launch (streambot `constants.ts` documents the sweep).
 *
 * 2026-09-12 investigation note: the acceptance eval at these values found a ~510-520ms
 * median endpoint delay (below the 650ms floor) alongside 88% clean recall. Raising
 * HEY_SCOUT/SCOUT to 350ms then 900ms left the delay essentially unchanged while recall
 * fell to 72% then 39% — reverted to these values (best recall of the three) rather than
 * ship a worse config while guessing further. The tail is not the lever that controls this
 * delay in the range tested; the recall collapse at high tail values points at a different
 * constraint (likely clip trailing-audio length or VAD/finishInput timeout) that needs
 * tracing through audio-lifecycle.ts before trying again. See
 * `voice-training/reports/2026-09-12-threshold-0.35.json` and the two later skip-soak
 * attempts recorded in that investigation.
 *
 * Must equal `tails` in `../../assets/voice/fragment-tails.json` — that JSON is what the M2
 * offline evaluator and packager read, and `session.test.ts` asserts the two stay identical.
 * Update both together; the JSON alone is not the production source of truth.
 */
export const VOICE_FRAGMENT_TAIL_MS: Readonly<Record<string, number>> = {
  HEY_SCOUT: 0,
  SCOUT: 0,
  HEY: 500,
};

/**
 * Normalized leading wake-prefix variants accepted by the strict transcript
 * gate. The gate compares against a lowercased transcript with punctuation
 * stripped, so "hey, scout" is already covered by "hey scout"; the remaining
 * entries absorb the transcription model's common mishearings. Tune against
 * the M2 evaluation corpus once the trained assets exist.
 */
export const VOICE_WAKE_PREFIXES: readonly string[] = [
  "hey scout",
  "a scout",
  "hey scott",
];

/** Pre-rendered local feedback WAVs, shipped beside the trained assets. */
export const VOICE_FEEDBACK_CLIP_FILES = {
  retry: "feedback-retry.wav",
  prompt: "feedback-prompt.wav",
} as const;

/**
 * The hey-scout asset layout inside `VOICE_ASSETS_DIR` (default
 * `/opt/scout/voice`). The keyword file, the tail table above, the trained
 * verifier graph, and the smoke fixtures are one packaging contract pinned by
 * `wake-verifier.json`; M2's packager and M5's Docker voice stage both target
 * exactly these filenames.
 */
export function scoutVoiceAssetManifest(assetsDir: string): VoiceAssetManifest {
  return {
    assetsDir,
    files: {
      encoder: "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      decoder: "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      joiner: "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      tokens: "tokens.txt",
      bpe: "bpe.model",
      keywords: "hey-scout.txt",
      smokeKeywords: "test_wavs/test_keywords.txt",
      smokePositive: "test_wavs/0.wav",
      vad: "silero_vad.onnx",
      wakeMel: "melspectrogram.onnx",
      wakeEmbedding: "embedding_model.onnx",
      wakeClassifier: "hey_scout.onnx",
      wakeSmokePositive: "hey-scout-smoke.wav",
      wakeManifest: "wake-verifier.json",
    },
  };
}
