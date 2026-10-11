import { describe, expect, it } from "vitest";
import { classifyAccessUnit } from "./annex-b.ts";

const AUD = 9;
const IDR = 5;
const NON_IDR = 1;
const SPS = 7;
const PPS = 8;

/** One Annex-B NAL: start code, header byte, then filler payload. */
function nal(type: number, options?: { startCodeLength?: 3 | 4 }): Buffer {
  const startCode =
    (options?.startCodeLength ?? 4) === 4
      ? Buffer.from([0, 0, 0, 1])
      : Buffer.from([0, 0, 1]);
  // nal_ref_idc = 3 for the types we synthesise; classification only reads the
  // low five bits, but a realistic header guards against a masking mistake.
  const header = Buffer.from([0x60 | type]);
  return Buffer.concat([startCode, header, Buffer.from([0xde, 0xad, 0xbe])]);
}

function accessUnit(
  types: readonly number[],
  options?: { startCodeLength?: 3 | 4 },
): Buffer {
  return Buffer.concat(types.map((type) => nal(type, options)));
}

const KEYFRAME_AU = accessUnit([AUD, SPS, PPS, IDR]);
const DELTA_AU = accessUnit([AUD, NON_IDR]);

describe("classifyAccessUnit", () => {
  it("marks an AU carrying SPS, PPS and IDR as a decoder entry point", () => {
    const unit = classifyAccessUnit(KEYFRAME_AU);
    expect(unit.isKeyframe).toBe(true);
    expect(unit.isDecoderEntryPoint).toBe(true);
  });

  it("marks an IDR without parameter sets as a keyframe but not an entry point", () => {
    const unit = classifyAccessUnit(accessUnit([AUD, IDR]));
    expect(unit.isKeyframe).toBe(true);
    expect(unit.isDecoderEntryPoint).toBe(false);
  });

  it("marks a non-IDR slice as neither", () => {
    const unit = classifyAccessUnit(DELTA_AU);
    expect(unit.isKeyframe).toBe(false);
    expect(unit.isDecoderEntryPoint).toBe(false);
  });

  it("reads NAL types through three-byte start codes", () => {
    const unit = classifyAccessUnit(
      accessUnit([AUD, SPS, PPS, IDR], { startCodeLength: 3 }),
    );
    expect(unit.isDecoderEntryPoint).toBe(true);
  });
});
