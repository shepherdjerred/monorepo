import { expect, test } from "bun:test";
import { replayTimedPacketEnvelopes } from "./replay-packet-clock.mjs";

const floatBits = new DataView(new ArrayBuffer(4));
function absolute(seconds) {
  floatBits.setFloat32(0, seconds, true);
  return floatBits.getUint32(0, true);
}

function record(chunkOffset, blockOffset, stream, compact, firstTimeBits) {
  return {
    chunkOffset,
    blockOffset,
    stream,
    marker: compact ? 129 : 1,
    firstTimeBits,
    secondTimeBits: 0x42123456,
    payload: Uint8Array.of(0x2a),
  };
}

test("adds integer milliseconds per anchor and preserves record and stream order", () => {
  const base = 1500.125;
  const records = [
    record(20, 0, 1, false, absolute(base)),
    record(20, 10, 1, true, 3),
    record(20, 15, 1, true, 5),
    record(20, 20, 1, true, 0),
    record(20, 25, 1, false, absolute(base + 0.125)),
    record(35, 0, 2, false, absolute(1)),
    record(50, 0, 1, false, absolute(base + 0.25)),
    record(50, 10, 1, true, 2),
  ];
  expect([...replayTimedPacketEnvelopes(records)]).toEqual(
    [
      base,
      base + 0.003,
      base + 0.008,
      base + 0.008,
      base + 0.125,
      1,
      base + 0.25,
      base + 0.252,
    ].map((timeSeconds, index) => ({ ...records[index], timeSeconds })),
  );
  expect(records.every((packet) => !Object.hasOwn(packet, "timeSeconds"))).toBe(
    true,
  );
});

test("fails on invalid anchors, delta width, regressions, and chunk order", () => {
  const start = record(20, 0, 1, false, absolute(2));
  const verify = (records, message) =>
    expect(() => [...replayTimedPacketEnvelopes(records)]).toThrow(message);
  verify([record(20, 0, 1, true, 0)], "initial anchor");
  verify([start, record(30, 0, 1, true, 0)], "initial anchor");
  verify([start, record(20, 5, 1, true, 256)], "clock bits");
  verify([start, record(20, 5, 1, false, absolute(1))], "clock order");
  verify([start, record(30, 0, 1, false, absolute(1))], "clock order");
  verify([start, record(19, 0, 2, false, absolute(2))], "chunk order");
  verify([record(20, 0, 1, false, absolute(-1))], "clock order");
  verify([record(20, 0, 1, false, absolute(Infinity))], "clock order");
});
