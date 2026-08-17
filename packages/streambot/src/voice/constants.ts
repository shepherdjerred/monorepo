/** Rolling audio retained before a permissive sherpa candidate. */
export const VOICE_WAKE_WINDOW_MS = 2000;

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
 * Added to every fragment tail. sherpa timestamps mark where the final token *began*, so the
 * matched audio runs a little past them, and training jittered the phrase up to 200 ms from the
 * window edge — landing slightly inside that band beats landing exactly on it.
 */
export const VOICE_FRAGMENT_TAIL_MARGIN_MS = 150;

/**
 * Fallback when a runtime reports no timestamps. Chosen as the measured zero-false-accept point:
 * local verification rejects everything, so nothing reaches paid cloud verification. It gives up
 * recall to guarantee the spend floor, which is the safe direction to fail.
 */
export const VOICE_VERIFICATION_DELAY_MS = 1250;

/**
 * Missing-packet gap after which Discord's DTX has stopped the RTP stream. Clients negotiate
 * `usedtx=1` and send ~5 trailing 20 ms comfort frames (~100 ms) after speech, then nothing —
 * so endpointing cannot be purely packet-driven, or every live turn would wait out the full
 * max-utterance timeout. Above the comfort tail plus per-packet jitter, and far below the
 * 650 ms Silero silence window, so it adds no endpoint latency of its own.
 */
export const VOICE_DTX_GAP_MS = 120;

/**
 * Granularity of the synthetic silence injected while a pending candidate sees no packets. One
 * tick bounds the extra endpoint latency; the ticker exists only while a candidate is pending.
 */
export const VOICE_DTX_TICK_MS = 100;

/**
 * Fixed identifiers, deliberately not configuration. The realtime model and reply voice were
 * z.literal env vars that could hold exactly one value — config theater. The wake phrase is
 * encoded in the trained keyword/verifier assets, so no env var could change it either.
 */
export const VOICE_REALTIME_MODEL = "gpt-realtime-2.1";
export const VOICE_ASSISTANT_VOICE = "marin";
