// Incremental FLV reader for the driver feed: ffmpeg's FLV output in, one
// Annex-B access unit per encoded frame out.
//
// The feed used to read a raw H.264 elementary stream, which carries no packet
// boundaries. An access unit could only be closed when the *next* one's
// delimiter arrived, so every frame waited one full frame interval (~33 ms)
// after ffmpeg had already written it. FLV states each tag's size up front, so a
// frame is complete the moment its last byte arrives.
//
// FLV carries H.264 as AVCC: a sequence-header tag with the
// AVCDecoderConfigurationRecord (SPS/PPS), then one tag per frame holding
// length-prefixed NAL units. The browser decodes Annex-B (no `description`), so
// each frame is rewritten with start codes, and keyframes get the parameter sets
// prepended so every keyframe stays a self-contained decoder entry point.
//
// Formats: Adobe FLV v10.1 (tags, VIDEODATA) and ISO/IEC 14496-15 5.3.3.1
// (AVCDecoderConfigurationRecord).

import { classifyAccessUnit, type AccessUnit } from "./annex-b.ts";

const FLV_SIGNATURE = "FLV";
const FLV_HEADER_BYTES = 9;
const PREVIOUS_TAG_SIZE_BYTES = 4;
const TAG_HEADER_BYTES = 11;

const TAG_TYPE_VIDEO = 9;
const CODEC_ID_AVC = 7;
const FRAME_TYPE_KEYFRAME = 1;
const AVC_PACKET_SEQUENCE_HEADER = 0;
const AVC_PACKET_NALU = 1;
const AVC_PACKET_END_OF_SEQUENCE = 2;
/** FrameType/CodecID byte + AVCPacketType + 24-bit composition time. */
const AVC_VIDEO_HEADER_BYTES = 5;
/** Enhanced-RTMP extended video header flag (FrameType's top bit). */
const EX_VIDEO_HEADER_FLAG = 0x80;

const NAL_SPS = 7;
const NAL_PPS = 8;
const START_CODE = Buffer.from([0, 0, 0, 1]);

type DecoderConfiguration = {
  readonly nalLengthBytes: number;
  /** SPS then PPS, each already prefixed with a start code. */
  readonly parameterSets: Buffer;
};

export class FlvFormatError extends Error {
  override readonly name = "FlvFormatError";
}

/** Parse an AVCDecoderConfigurationRecord into Annex-B parameter sets. */
function parseDecoderConfiguration(record: Buffer): DecoderConfiguration {
  // version(1) profile(1) compat(1) level(1) lengthSizeMinusOne(1) numSPS(1)
  if (record.length < 7 || record[0] !== 1) {
    throw new FlvFormatError("malformed AVCDecoderConfigurationRecord");
  }
  const nalLengthBytes = ((record[4] ?? 0) & 0b11) + 1;
  const parts: Buffer[] = [];
  let at = 5;
  const readSets = (count: number): void => {
    for (let i = 0; i < count; i++) {
      if (at + 2 > record.length) {
        throw new FlvFormatError("truncated parameter set length");
      }
      const length = record.readUInt16BE(at);
      at += 2;
      if (at + length > record.length) {
        throw new FlvFormatError("truncated parameter set");
      }
      parts.push(START_CODE, record.subarray(at, at + length));
      at += length;
    }
  };
  readSets((record[at++] ?? 0) & 0b1_1111);
  if (at >= record.length) {
    throw new FlvFormatError("AVCDecoderConfigurationRecord has no PPS count");
  }
  readSets(record[at++] ?? 0);
  return { nalLengthBytes, parameterSets: Buffer.concat(parts) };
}

/** Rewrite length-prefixed NAL units as Annex-B, noting parameter sets seen. */
function avccToAnnexB(
  payload: Buffer,
  nalLengthBytes: number,
): { bytes: Buffer; hasParameterSets: boolean } {
  const parts: Buffer[] = [];
  let hasSps = false;
  let hasPps = false;
  let at = 0;
  while (at < payload.length) {
    if (at + nalLengthBytes > payload.length) {
      throw new FlvFormatError("truncated NAL length");
    }
    const length = payload.readUIntBE(at, nalLengthBytes);
    at += nalLengthBytes;
    if (length === 0 || at + length > payload.length) {
      throw new FlvFormatError("NAL length exceeds its tag");
    }
    const nalType = (payload[at] ?? 0) & 0x1f;
    if (nalType === NAL_SPS) hasSps = true;
    if (nalType === NAL_PPS) hasPps = true;
    parts.push(START_CODE, payload.subarray(at, at + length));
    at += length;
  }
  return { bytes: Buffer.concat(parts), hasParameterSets: hasSps && hasPps };
}

/**
 * Stateful reader fed arbitrary chunks from ffmpeg's stdout.
 *
 * Holds at most one partial tag, so memory is bounded by the encoder's frame
 * size. Malformed input throws {@link FlvFormatError}: the stream has no resync
 * point, so the caller must restart the encoder.
 */
export class FlvAccessUnitReader {
  private carry: Buffer = Buffer.alloc(0);
  private headerRead = false;
  private config: DecoderConfiguration | undefined;

  /** Feed one chunk; returns every access unit completed by it (possibly none). */
  push(chunk: Buffer): AccessUnit[] {
    if (chunk.length === 0) return [];
    const joined =
      this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    const buf = this.headerRead ? joined : this.consumeHeader(joined);
    const units: AccessUnit[] = [];
    if (buf === undefined) {
      this.carry = Buffer.from(joined);
      return units;
    }

    let at = 0;
    while (at + TAG_HEADER_BYTES <= buf.length) {
      const dataSize = buf.readUIntBE(at + 1, 3);
      const tagEnd = at + TAG_HEADER_BYTES + dataSize;
      if (tagEnd + PREVIOUS_TAG_SIZE_BYTES > buf.length) break;
      const previousTagSize = buf.readUInt32BE(tagEnd);
      if (previousTagSize !== TAG_HEADER_BYTES + dataSize) {
        throw new FlvFormatError(
          `tag size mismatch: header ${String(TAG_HEADER_BYTES + dataSize)}, trailer ${String(previousTagSize)}`,
        );
      }
      const tagType = (buf[at] ?? 0) & 0x1f;
      if (tagType === TAG_TYPE_VIDEO) {
        const unit = this.readVideoTag(
          buf.subarray(at + TAG_HEADER_BYTES, tagEnd),
        );
        if (unit !== undefined) units.push(unit);
      }
      at = tagEnd + PREVIOUS_TAG_SIZE_BYTES;
    }

    this.carry = Buffer.from(buf.subarray(at));
    return units;
  }

  /** Validate the file header; returns the bytes after it, or undefined if short. */
  private consumeHeader(buf: Buffer): Buffer | undefined {
    const needed = FLV_HEADER_BYTES + PREVIOUS_TAG_SIZE_BYTES;
    if (buf.length < needed) return undefined;
    if (buf.toString("latin1", 0, 3) !== FLV_SIGNATURE) {
      throw new FlvFormatError("missing FLV signature");
    }
    const dataOffset = buf.readUInt32BE(5);
    if (dataOffset !== FLV_HEADER_BYTES) {
      throw new FlvFormatError(
        `unexpected FLV header size ${String(dataOffset)}`,
      );
    }
    this.headerRead = true;
    return buf.subarray(needed);
  }

  private readVideoTag(data: Buffer): AccessUnit | undefined {
    if (data.length < AVC_VIDEO_HEADER_BYTES) {
      throw new FlvFormatError("truncated video tag");
    }
    const first = data.readUInt8(0);
    const packetType = data.readUInt8(1);
    if ((first & EX_VIDEO_HEADER_FLAG) !== 0) {
      throw new FlvFormatError("enhanced FLV video headers are not supported");
    }
    if ((first & 0x0f) !== CODEC_ID_AVC) {
      throw new FlvFormatError(
        `unexpected FLV codec id ${String(first & 0x0f)}`,
      );
    }
    const payload = data.subarray(AVC_VIDEO_HEADER_BYTES);
    switch (packetType) {
      case AVC_PACKET_SEQUENCE_HEADER:
        this.config = parseDecoderConfiguration(payload);
        return undefined;
      case AVC_PACKET_END_OF_SEQUENCE:
        return undefined;
      case AVC_PACKET_NALU: {
        const config = this.config;
        if (config === undefined) {
          throw new FlvFormatError("video frame before its sequence header");
        }
        const annexB = avccToAnnexB(payload, config.nalLengthBytes);
        const isKeyframe = first >> 4 === FRAME_TYPE_KEYFRAME;
        // FLV moves SPS/PPS out of band; a keyframe without them in band could
        // not start a cold decoder, which is what the hub's late-join relies on.
        const bytes =
          isKeyframe && !annexB.hasParameterSets
            ? Buffer.concat([config.parameterSets, annexB.bytes])
            : annexB.bytes;
        return classifyAccessUnit(bytes);
      }
      default:
        throw new FlvFormatError(
          `unexpected AVC packet type ${String(packetType)}`,
        );
    }
  }
}
