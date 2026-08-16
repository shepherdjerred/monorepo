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
