// Incremental Annex-B access-unit splitter for the driver feed.
//
// ffmpeg writes the driver feed as a raw H.264 elementary stream to a pipe, so
// packet boundaries are lost — the reader sees an undelimited byte stream. The
// encoder runs with `-bsf:v h264_metadata=aud=insert`, which guarantees every
// access unit begins with an Access Unit Delimiter (NAL type 9). That makes the
// boundary rule exact: an AUD start code opens a new AU and closes the previous
// one.
//
// WebCodecs wants one `EncodedVideoChunk` per access unit
// (w3c.github.io/webcodecs/avc_codec_registration.html section 2), so the split
// has to happen somewhere. Doing it here rather than in the browser keeps the
// parsing in testable TypeScript and lets the hub classify keyframes for its
// late-join cache without every client re-deriving the same facts.

/** NAL unit types we care about (ITU-T H.264 table 7-1). */
const NAL_IDR_SLICE = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_ACCESS_UNIT_DELIMITER = 9;

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
   * here with no prior state. `-f h264` repeats SPS/PPS in-band ahead of every
   * IDR (raw Annex-B output does not use global headers), so keyframe AUs
   * normally satisfy this; the hub refuses to seed a new client with anything
   * that does not.
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

/**
 * Stateful splitter fed arbitrary chunks from ffmpeg's stdout.
 *
 * Holds at most one in-flight access unit plus the current chunk, so memory is
 * bounded by the encoder's frame size rather than by stream duration.
 */
export class AnnexBSplitter {
  /** Bytes from the start of the in-flight AU (or the unresolved stream head) onward. */
  private carry: Buffer = Buffer.alloc(0);
  /** Offset into `carry` where the in-flight AU begins, or -1 before the first AUD. */
  private accessUnitStart = -1;
  /** Offset into `carry` already scanned for start codes. */
  private scanned = 0;
  private droppedLeadingBytes = 0;

  /**
   * Bytes discarded because they preceded the first AUD and therefore belonged to
   * an access unit whose start was never observed. Expected to stay 0 in
   * production; a non-zero value means the AUD bitstream filter is not applied.
   */
  get leadingBytesDropped(): number {
    return this.droppedLeadingBytes;
  }

  /** Feed one chunk; returns every access unit completed by it (possibly none). */
  push(chunk: Buffer): AccessUnit[] {
    if (chunk.length === 0) return [];
    const buf =
      this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    const units: AccessUnit[] = [];

    // Classifying a start code needs its NAL header byte, so stop once fewer
    // than four bytes remain and let the next chunk complete it. `cursor` ends
    // up at the first offset that still needs examining next time.
    let cursor = this.scanned;
    for (;;) {
      const at = indexOfStartCode(buf, cursor);
      if (at === -1) {
        // Only a partial start code can still be pending, so rewind just far
        // enough to match the longest one that straddles this chunk boundary.
        cursor = Math.max(buf.length - (MAX_START_CODE_LENGTH - 1), 0);
        break;
      }
      if (at + startCodeLengthAt(buf, at) >= buf.length) {
        // Start code present but its NAL header byte has not arrived. Re-examine
        // it next chunk — it may well be the AUD that opens the next AU.
        cursor = at;
        break;
      }
      if (nalTypeAt(buf, at) === NAL_ACCESS_UNIT_DELIMITER) {
        if (this.accessUnitStart === -1) {
          this.droppedLeadingBytes += at;
        } else if (at > this.accessUnitStart) {
          units.push(
            classifyAccessUnit(
              Buffer.from(buf.subarray(this.accessUnitStart, at)),
            ),
          );
        }
        // `at === accessUnitStart` means we re-scanned the AUD that opened the
        // in-flight AU (it was truncated last chunk); reopening at the same
        // offset is a no-op rather than an empty unit.
        this.accessUnitStart = at;
      }
      cursor = at + startCodeLengthAt(buf, at);
    }

    const retainFrom =
      this.accessUnitStart === -1
        ? // No AUD yet, so nothing before `cursor` can ever be decoded. Dropping
          // it is safe because clients only ever start at a decoder entry point.
          Math.min(Math.max(cursor, 0), buf.length)
        : this.accessUnitStart;
    if (this.accessUnitStart === -1) {
      this.droppedLeadingBytes += retainFrom;
      this.scanned = 0;
    } else {
      this.scanned = Math.max(cursor - retainFrom, 0);
      this.accessUnitStart = 0;
    }
    this.carry = Buffer.from(buf.subarray(retainFrom));
    return units;
  }

  /** Emit the trailing access unit, if any. Call once when the encoder exits. */
  flush(): AccessUnit | undefined {
    if (this.accessUnitStart === -1 || this.carry.length === 0)
      return undefined;
    const unit = classifyAccessUnit(
      Buffer.from(this.carry.subarray(this.accessUnitStart)),
    );
    this.carry = Buffer.alloc(0);
    this.accessUnitStart = -1;
    this.scanned = 0;
    return unit;
  }
}
