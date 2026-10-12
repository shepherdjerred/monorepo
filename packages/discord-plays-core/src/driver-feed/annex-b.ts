// Annex-B access-unit classification for the driver feed.
//
// WebCodecs wants one `EncodedVideoChunk` per access unit
// (w3c.github.io/webcodecs/avc_codec_registration.html section 2). The FLV
// reader (`flv.ts`) produces those units; this module classifies them so the hub
// can pick late-join entry points without every client re-deriving the facts.

/** NAL unit types we care about (ITU-T H.264 table 7-1). */
const NAL_IDR_SLICE = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;

/** Shortest legal Annex-B start code, `00 00 01`. */
const START_CODE_LENGTH = 3;
/** Longest legal Annex-B start code, `00 00 00 01`. */
const MAX_START_CODE_LENGTH = 4;

export type AccessUnit = {
  /** The complete access unit, start codes included, ready to hand to a decoder. */
  readonly bytes: Buffer;
  /** Contains an IDR slice — safe to begin decoding at, given parameter sets. */
  readonly isKeyframe: boolean;
  /**
   * Contains an IDR slice *and* both parameter sets, so a cold decoder can start
   * here with no prior state. The FLV reader prepends SPS/PPS to every
   * keyframe, so keyframe AUs satisfy this; the hub refuses to seed a new
   * client with anything that does not.
   */
  readonly isDecoderEntryPoint: boolean;
};

/**
 * Index of the next start code at or after `from`, or -1.
 *
 * The scan matches the three-byte `00 00 01`, then extends one byte backwards
 * when the preceding byte is zero so a four-byte `00 00 00 01` is reported at
 * its true start. Without that, the leading zero would be left behind as a
 * trailing byte of the previous NAL — legal Annex-B, but it makes access units
 * differ from the encoder's own framing and defeats byte-exact tests.
 *
 * `floor` bounds the backward extension so a start code can never be reported
 * before the region the caller is scanning.
 */
function indexOfStartCode(buf: Buffer, from: number, floor = 0): number {
  for (let i = Math.max(from, 0); i + START_CODE_LENGTH <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      return i > floor && buf[i - 1] === 0 ? i - 1 : i;
    }
  }
  return -1;
}

/** Length of the start code beginning at `index` (3 or 4 bytes). */
function startCodeLengthAt(buf: Buffer, index: number): number {
  return buf[index + 2] === 1 ? START_CODE_LENGTH : MAX_START_CODE_LENGTH;
}

/** NAL type of the unit whose start code begins at `startCodeIndex`, or -1 if truncated. */
function nalTypeAt(buf: Buffer, startCodeIndex: number): number {
  const header = buf[startCodeIndex + startCodeLengthAt(buf, startCodeIndex)];
  return header === undefined ? -1 : header & 0x1f;
}

/**
 * Classify a complete access unit by walking its NAL headers.
 *
 * Exported for tests: the streaming splitter's correctness rests on this, and it
 * is a pure function of the bytes.
 */
export function classifyAccessUnit(bytes: Buffer): AccessUnit {
  let hasIdr = false;
  let hasSps = false;
  let hasPps = false;
  for (
    let at = indexOfStartCode(bytes, 0);
    at !== -1;
    at = indexOfStartCode(bytes, at + startCodeLengthAt(bytes, at))
  ) {
    switch (nalTypeAt(bytes, at)) {
      case NAL_IDR_SLICE:
        hasIdr = true;
        break;
      case NAL_SPS:
        hasSps = true;
        break;
      case NAL_PPS:
        hasPps = true;
        break;
      default:
        break;
    }
  }
  return {
    bytes,
    isKeyframe: hasIdr,
    isDecoderEntryPoint: hasIdr && hasSps && hasPps,
  };
}
