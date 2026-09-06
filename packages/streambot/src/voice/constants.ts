import type { VoiceAssetManifest } from "@shepherdjerred/voice-assistant/asset-manifest.ts";

// Rolling audio retained before a permissive sherpa candidate — shared pipeline constant,
// re-exported so config/schema.ts and the corpus tooling keep their historical import site.
export { VOICE_WAKE_WINDOW_MS } from "@shepherdjerred/voice-assistant/constants.ts";

/**
 * Milliseconds of audio still to come after a matched fragment ends, before the wake phrase is
 * complete.
 *
 * The phrase verifier scores the LAST two seconds it is handed and was trained with the phrase
 * end-aligned (+/-200 ms jitter), so the window must close just after the phrase finishes. Two
 * measured facts make a single fixed delay impossible:
 *
 *  1. sherpa emits its decision well after the audio it matched (~280 ms on the smoke fixture) and
 *     that lag varies with decoder state — larger than the verifier's ~350 ms total tolerance.
 *  2. The keyword file declares six fragments that end at very different points in the phrase:
 *     `HEY` leaves most of "streambot" still unsaid, while `STREAMBOT` and `BOT` end with it.
 *
 * Sweeping a fixed delay from the emission confirmed this: no value scored better than 1/11 on real
 * recordings, and every value with any recall also admitted false wakes. Anchoring instead to the
 * fragment's own timestamp, with a per-fragment tail, removes both sources of variance.
 */
export const VOICE_FRAGMENT_TAIL_MS: Readonly<Record<string, number>> = {
  HEY_STREAMBOT: 0,
  HEY_STREAM_BOT: 0,
  STREAMBOT: 0,
  BOT: 0,
  STREAM: 250,
  HEY: 600,
};

/**
 * Fixed identifiers, deliberately not configuration. The realtime model and reply voice were
 * z.literal env vars that could hold exactly one value — config theater. The wake phrase is
 * encoded in the trained keyword/verifier assets, so no env var could change it either.
 */
export const VOICE_REALTIME_MODEL = "gpt-realtime-2.1";
export const VOICE_ASSISTANT_VOICE = "marin";

/** Normalized leading wake-prefix variants accepted by the strict transcript gate. */
export const VOICE_WAKE_PREFIXES: readonly string[] = [
  "hey streambot",
  "hey stream bot",
  "hey streamboat",
];

export const VOICE_INSTRUCTIONS = `You are Streambot, a voice-only media playback controller.
Handle exactly one concise playback request. You may only use the supplied Streambot tools.
Never answer general knowledge, browse, accept URLs, or invent media state.
For a clear request, call the single best tool and briefly speak its result.
Default play requests to source auto, which searches history, local files, and YouTube.
Treat “song by character” requests as likely AI covers; preserve the work and character in the query.
For “again”, “that song”, numbered choices, and similar references, use history or the pending search context.
When a title is uncertain, call search_media first. Read at most three choices and ask for first, second, or third.
Use placement queue unless the speaker explicitly says next or now.
Never call more than one mutating tool. Keep every spoken reply to one short sentence.`;

/** Pre-rendered local feedback WAVs; regenerate with scripts/voice-feedback-generate.ts. */
export const VOICE_FEEDBACK_CLIP_FILES = {
  retry: "feedback-retry.wav",
  prompt: "feedback-prompt.wav",
} as const;

/**
 * The hey-streambot asset layout inside one assets directory. The keyword file, tail table
 * above, trained verifier graph, and smoke fixtures are one packaging contract, pinned by
 * wake-verifier.json.
 */
export function streambotVoiceAssetManifest(
  assetsDir: string,
): VoiceAssetManifest {
  return {
    assetsDir,
    files: {
      encoder: "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      decoder: "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      joiner: "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      tokens: "tokens.txt",
      bpe: "bpe.model",
      keywords: "hey-streambot.txt",
      smokeKeywords: "test_wavs/test_keywords.txt",
      smokePositive: "test_wavs/0.wav",
      vad: "silero_vad.onnx",
      wakeMel: "melspectrogram.onnx",
      wakeEmbedding: "embedding_model.onnx",
      wakeClassifier: "hey_streambot.onnx",
      wakeSmokePositive: "hey-streambot-smoke.wav",
      wakeManifest: "wake-verifier.json",
    },
  };
}
