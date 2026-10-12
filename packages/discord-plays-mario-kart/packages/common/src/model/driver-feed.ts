import { z } from "zod";

/**
 * The driver feed's WebSocket path. Deliberately distinct from Socket.IO's
 * `/socket.io/` so the two share one HTTP server but not one TCP connection —
 * video bytes must never sit ahead of a controller input in a send queue.
 */
export const DRIVER_FEED_PATH = "/video";

/**
 * Length of the header prefixing every binary media message.
 *
 * `EncodedVideoChunk` requires the caller to declare whether a chunk is a key
 * or delta frame, and getting it wrong throws and kills the decoder. The server
 * has already parsed the NAL types to make its own fan-out decisions, so it
 * states the answer in one byte rather than making every client re-parse the
 * bitstream.
 */
export const DRIVER_FEED_HEADER_BYTES = 1;
/** Set in the header byte when the access unit is a cold-start decoder entry point. */
export const DRIVER_FEED_KEYFRAME_FLAG = 0x01;
/**
 * Set in the header byte when the payload is game audio rather than video:
 * interleaved s16le PCM at the init message's rate and channel count.
 *
 * Raw PCM rather than Opus keeps the page on the plain Web Audio API (no
 * `AudioDecoder`, which not every browser that decodes the video ships) and
 * adds no codec delay. At MK64's 26.8 kHz stereo it is ~860 kbps, next to the
 * video's 2.5 Mbps.
 */
export const DRIVER_FEED_AUDIO_FLAG = 0x02;

/**
 * First frame on the socket, sent as text before any media.
 *
 * Everything after it is binary: a one-byte header followed by either one H.264
 * access unit, Annex-B framed, or one chunk of PCM audio (`DRIVER_FEED_AUDIO_FLAG`). The server states the codec rather than letting the
 * client guess, because `VideoDecoder.configure` needs an exact profile/level
 * string and the encoder is the only side that knows what it was told to
 * produce. No `description` is sent: per the W3C AVC registration, omitting it
 * selects Annex-B, which is what a live stream with in-band SPS/PPS is.
 */
export type DriverFeedInit = z.infer<typeof DriverFeedInitSchema>;
export const DriverFeedInitSchema = z.strictObject({
  kind: z.literal("init"),
  /** RFC 6381 codec string, e.g. `avc1.4D4028`. */
  codec: z.string().min(1),
  /** Square-pixel dimensions of the encoded image (already aspect-corrected). */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
  /** Audio chunks are interleaved s16le PCM in this format. */
  audioSampleRate: z.number().int().positive(),
  audioChannels: z.number().int().positive(),
});

/**
 * Client acknowledgement sent only after WebCodecs has accepted the init
 * configuration. The server does not admit the socket to the media hub before
 * this arrives, so the first decoder entry point cannot race async setup.
 */
export type DriverFeedReady = z.infer<typeof DriverFeedReadySchema>;
export const DriverFeedReadySchema = z.strictObject({
  kind: z.literal("ready"),
});
