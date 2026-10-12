import { describe, expect, it } from "vitest";
import { FlvAccessUnitReader, FlvFormatError } from "#src/driver-feed/flv.ts";

const SPS = Buffer.from([0x67, 0x4d, 0x40, 0x28, 0xaa]);
const PPS = Buffer.from([0x68, 0xee, 0x3c, 0x80]);
const IDR = Buffer.from([0x65, 0x88, 0x84, 0x00]);
const SEI = Buffer.from([0x06, 0x05, 0x01, 0x02]);
const SLICE = Buffer.from([0x41, 0x9a, 0x21, 0x6c]);
const START = Buffer.from([0, 0, 0, 1]);

function flvHeader(): Buffer {
  return Buffer.concat([
    Buffer.from("FLV", "latin1"),
    Buffer.from([1, 0x01, 0, 0, 0, 9]),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function tag(type: number, data: Buffer, timestamp = 0): Buffer {
  const header = Buffer.alloc(11);
  header[0] = type;
  header.writeUIntBE(data.length, 1, 3);
  header.writeUIntBE(timestamp & 0xff_ff_ff, 4, 3);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(11 + data.length);
  return Buffer.concat([header, data, trailer]);
}

function sequenceHeader(): Buffer {
  const record = Buffer.concat([
    Buffer.from([1, 0x4d, 0x40, 0x28, 0xff, 0xe1]),
    Buffer.from([0, SPS.length]),
    SPS,
    Buffer.from([1, 0, PPS.length]),
    PPS,
  ]);
  return tag(9, Buffer.concat([Buffer.from([0x17, 0, 0, 0, 0]), record]));
}

function lengthPrefixed(nals: readonly Buffer[]): Buffer {
  return Buffer.concat(
    nals.flatMap((nal) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(nal.length);
      return [length, nal];
    }),
  );
}

function frame(keyframe: boolean, nals: readonly Buffer[]): Buffer {
  return tag(
    9,
    Buffer.concat([
      Buffer.from([keyframe ? 0x17 : 0x27, 1, 0, 0, 0]),
      lengthPrefixed(nals),
    ]),
  );
}

function annexB(nals: readonly Buffer[]): Buffer {
  return Buffer.concat(nals.flatMap((nal) => [START, nal]));
}

const STREAM = Buffer.concat([
  flvHeader(),
  sequenceHeader(),
  frame(true, [SEI, IDR]),
  frame(false, [SLICE]),
]);

describe("FlvAccessUnitReader", () => {
  it("emits one Annex-B access unit per frame tag", () => {
    const units = new FlvAccessUnitReader().push(STREAM);
    expect(units).toHaveLength(2);
    expect(units[1]?.bytes).toEqual(annexB([SLICE]));
    expect(units[1]?.isKeyframe).toBe(false);
  });

  it("prepends the parameter sets to keyframes so they are entry points", () => {
    const [keyframe] = new FlvAccessUnitReader().push(STREAM);
    expect(keyframe?.bytes).toEqual(annexB([SPS, PPS, SEI, IDR]));
    expect(keyframe?.isDecoderEntryPoint).toBe(true);
  });

  it("does not duplicate parameter sets already carried in band", () => {
    const reader = new FlvAccessUnitReader();
    const [unit] = reader.push(
      Buffer.concat([
        flvHeader(),
        sequenceHeader(),
        frame(true, [SPS, PPS, IDR]),
      ]),
    );
    expect(unit?.bytes).toEqual(annexB([SPS, PPS, IDR]));
  });

  it("emits a frame as soon as its tag is complete, at any chunking", () => {
    for (let size = 1; size <= STREAM.length; size += 7) {
      const reader = new FlvAccessUnitReader();
      const units = [];
      for (let at = 0; at < STREAM.length; at += size) {
        units.push(...reader.push(STREAM.subarray(at, at + size)));
      }
      expect(units.map((u) => u.bytes)).toEqual([
        annexB([SPS, PPS, SEI, IDR]),
        annexB([SLICE]),
      ]);
    }
  });

  it("does not hold a complete frame back waiting for the next one", () => {
    const reader = new FlvAccessUnitReader();
    reader.push(
      Buffer.concat([flvHeader(), sequenceHeader(), frame(true, [IDR])]),
    );
    expect(reader.push(frame(false, [SLICE]))).toHaveLength(1);
  });

  it("skips non-video tags", () => {
    const units = new FlvAccessUnitReader().push(
      Buffer.concat([
        flvHeader(),
        tag(18, Buffer.from([2, 0, 0])),
        sequenceHeader(),
        frame(false, [SLICE]),
      ]),
    );
    expect(units).toHaveLength(1);
  });

  it("rejects input that is not FLV", () => {
    expect(() =>
      new FlvAccessUnitReader().push(Buffer.alloc(16, 0x47)),
    ).toThrow(FlvFormatError);
  });

  it("rejects a frame before its sequence header", () => {
    expect(() =>
      new FlvAccessUnitReader().push(
        Buffer.concat([flvHeader(), frame(false, [SLICE])]),
      ),
    ).toThrow(/before its sequence header/);
  });

  it("rejects a tag whose trailer disagrees with its header", () => {
    const corrupt = Buffer.from(frame(false, [SLICE]));
    corrupt.writeUInt32BE(1, corrupt.length - 4);
    expect(() =>
      new FlvAccessUnitReader().push(
        Buffer.concat([flvHeader(), sequenceHeader(), corrupt]),
      ),
    ).toThrow(/tag size mismatch/);
  });

  it("rejects a NAL length that overruns its tag", () => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(999);
    const bad = tag(
      9,
      Buffer.concat([Buffer.from([0x27, 1, 0, 0, 0]), length, SLICE]),
    );
    expect(() =>
      new FlvAccessUnitReader().push(
        Buffer.concat([flvHeader(), sequenceHeader(), bad]),
      ),
    ).toThrow(/exceeds its tag/);
  });

  it("rejects codecs other than AVC", () => {
    const hevcLegacy = tag(9, Buffer.from([0x1c, 1, 0, 0, 0]));
    expect(() =>
      new FlvAccessUnitReader().push(Buffer.concat([flvHeader(), hevcLegacy])),
    ).toThrow(/codec id/);
  });
});
