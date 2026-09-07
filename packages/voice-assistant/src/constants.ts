/** Rolling audio retained before a permissive sherpa candidate. */
export const VOICE_WAKE_WINDOW_MS = 2000;

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
