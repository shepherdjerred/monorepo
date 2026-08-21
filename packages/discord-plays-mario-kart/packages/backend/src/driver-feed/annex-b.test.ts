import { describe, expect, it } from "vitest";
import { AnnexBSplitter, classifyAccessUnit } from "./annex-b.ts";

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
  // nal_ref_idc = 3 for the types we synthesise; the splitter only reads the
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

/** Feed a whole stream and collect every unit, flush included. */
function splitAll(chunks: readonly Buffer[]): {
  units: ReturnType<AnnexBSplitter["push"]>;
  dropped: number;
} {
  const splitter = new AnnexBSplitter();
  const units = chunks.flatMap((chunk) => splitter.push(chunk));
  const tail = splitter.flush();
  if (tail !== undefined) units.push(tail);
  return { units, dropped: splitter.leadingBytesDropped };
}

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

describe("AnnexBSplitter", () => {
  it("splits a stream on AUD boundaries and preserves AU bytes exactly", () => {
    const { units, dropped } = splitAll([
      Buffer.concat([KEYFRAME_AU, DELTA_AU, DELTA_AU]),
    ]);

    expect(units).toHaveLength(3);
    expect(dropped).toBe(0);
    expect(units[0]?.bytes).toEqual(KEYFRAME_AU);
    expect(units[1]?.bytes).toEqual(DELTA_AU);
    expect(units[2]?.bytes).toEqual(DELTA_AU);
    expect(units.map((unit) => unit.isKeyframe)).toEqual([true, false, false]);
  });

  it("holds the final AU until flush, since no AUD closes it", () => {
    const splitter = new AnnexBSplitter();
    expect(splitter.push(KEYFRAME_AU)).toHaveLength(0);
    expect(splitter.flush()?.bytes).toEqual(KEYFRAME_AU);
    expect(splitter.flush()).toBeUndefined();
  });

  it("produces identical output when fed one byte at a time", () => {
    const stream = Buffer.concat([KEYFRAME_AU, DELTA_AU, KEYFRAME_AU]);
    const oneShot = splitAll([stream]);
    const byteWise = splitAll([...stream].map((byte) => Buffer.from([byte])));

    expect(byteWise.units.map((unit) => unit.bytes)).toEqual(
      oneShot.units.map((unit) => unit.bytes),
    );
    expect(byteWise.units.map((unit) => unit.isDecoderEntryPoint)).toEqual([
      true,
      false,
      true,
    ]);
    expect(byteWise.dropped).toBe(0);
  });

  it("recovers a start code split across a chunk boundary", () => {
    const stream = Buffer.concat([KEYFRAME_AU, DELTA_AU]);
    // Cut two bytes into the second AU's four-byte start code.
    const cut = KEYFRAME_AU.length + 2;
    const { units } = splitAll([stream.subarray(0, cut), stream.subarray(cut)]);

    expect(units.map((unit) => unit.bytes)).toEqual([KEYFRAME_AU, DELTA_AU]);
  });

  it("recovers when a chunk ends between a start code and its NAL header", () => {
    const stream = Buffer.concat([KEYFRAME_AU, DELTA_AU]);
    // Cut immediately after the second AU's start code, before the AUD header.
    const cut = KEYFRAME_AU.length + 4;
    const { units } = splitAll([stream.subarray(0, cut), stream.subarray(cut)]);

    expect(units.map((unit) => unit.bytes)).toEqual([KEYFRAME_AU, DELTA_AU]);
  });

  it("handles three-byte start codes", () => {
    const keyframe = accessUnit([AUD, SPS, PPS, IDR], { startCodeLength: 3 });
    const delta = accessUnit([AUD, NON_IDR], { startCodeLength: 3 });
    const { units } = splitAll([Buffer.concat([keyframe, delta])]);

    expect(units.map((unit) => unit.bytes)).toEqual([keyframe, delta]);
  });

  it("drops and counts bytes preceding the first AUD", () => {
    const orphan = nal(NON_IDR);
    const { units, dropped } = splitAll([
      Buffer.concat([orphan, KEYFRAME_AU, DELTA_AU]),
    ]);

    expect(units.map((unit) => unit.bytes)).toEqual([KEYFRAME_AU, DELTA_AU]);
    expect(dropped).toBe(orphan.length);
  });

  it("counts dropped leading bytes across chunks that contain no AUD", () => {
    const orphan = Buffer.concat([nal(NON_IDR), nal(NON_IDR)]);
    const splitter = new AnnexBSplitter();
    splitter.push(orphan);
    splitter.push(KEYFRAME_AU);
    splitter.flush();

    expect(splitter.leadingBytesDropped).toBe(orphan.length);
  });

  it("treats an empty chunk as a no-op", () => {
    const splitter = new AnnexBSplitter();
    expect(splitter.push(Buffer.alloc(0))).toHaveLength(0);
    expect(splitter.push(KEYFRAME_AU)).toHaveLength(0);
    expect(splitter.push(Buffer.alloc(0))).toHaveLength(0);
    expect(splitter.push(DELTA_AU)).toHaveLength(1);
  });

  it("does not emit an empty unit when an AUD is rescanned after truncation", () => {
    const stream = Buffer.concat([KEYFRAME_AU, DELTA_AU]);
    // Land the boundary exactly on the last byte of the second start code so the
    // AUD is found but unclassifiable, forcing a rescan of the same offset.
    const cut = KEYFRAME_AU.length + 3;
    const { units } = splitAll([stream.subarray(0, cut), stream.subarray(cut)]);

    expect(units.map((unit) => unit.bytes)).toEqual([KEYFRAME_AU, DELTA_AU]);
    expect(units.every((unit) => unit.bytes.length > 0)).toBe(true);
  });
});
