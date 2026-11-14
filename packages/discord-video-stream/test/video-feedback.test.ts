import { describe, expect, test } from "vitest";
import { parseVideoFeedback } from "../src/client/voice/VideoFeedback.js";

const SSRC = 1234;

function packet(type: number, count: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  buffer[0] = 0x80 | count;
  buffer[1] = type;
  buffer.writeUInt16BE(length / 4 - 1, 2);
  return buffer;
}

function report(type = 201, target = SSRC): Buffer {
  const offset = type === 200 ? 28 : 8;
  const buffer = packet(type, 1, offset + 24);
  buffer.writeUInt32BE(target, offset);
  buffer[offset + 4] = 64;
  buffer.writeIntBE(-2, offset + 5, 3);
  buffer.writeUInt32BE(4500, offset + 12);
  return buffer;
}

function feedback(type: number, fmt: number, length: number, target = SSRC): Buffer {
  const buffer = packet(type, fmt, length);
  buffer.writeUInt32BE(target, 8);
  return buffer;
}

describe("video RTCP feedback", () => {
  test.each([200, 201])("reads video loss and jitter from PT%s report blocks", (type) => {
    expect(parseVideoFeedback(report(type), SSRC)).toEqual([{
      type: "receiver-report", fractionLost: 0.25, cumulativePacketsLost: -2, jitterSeconds: 0.05,
    }]);
  });

  test("counts all NACK PID/BLP requests, including sequence wrap, without exposing identities", () => {
    const nack = feedback(205, 1, 20);
    nack.writeUInt16BE(65535, 12);
    nack.writeUInt16BE(0b101, 14);
    nack.writeUInt16BE(25, 16);
    nack.writeUInt16BE(0xffff, 18);
    expect(parseVideoFeedback(nack, SSRC)).toEqual([{ type: "nack", requestedPackets: 20 }]);
  });

  test("decodes compound RR, PLI and FIR, filtering FIR targets from its FCI entries", () => {
    const fir = feedback(206, 4, 28, 0);
    fir.writeUInt32BE(999, 12);
    fir.writeUInt32BE(SSRC, 20);
    expect(parseVideoFeedback(Buffer.concat([report(), feedback(206, 1, 12), fir]), SSRC)).toEqual([
      { type: "receiver-report", fractionLost: 0.25, cumulativePacketsLost: -2, jitterSeconds: 0.05 },
      { type: "pli" }, { type: "fir", requests: 1 },
    ]);
  });

  test("ignores other media, unknown RTCP and incoming RTP", () => {
    expect(parseVideoFeedback(Buffer.concat([report(201, 999), feedback(205, 1, 16, 999), feedback(206, 1, 12, 999), packet(207, 0, 8)]), SSRC)).toEqual([]);
    expect(parseVideoFeedback(Buffer.from([128, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), SSRC)).toEqual([]);
  });

  test("accepts padding only on the final compound packet", () => {
    const padded = Buffer.concat([feedback(206, 1, 12), Buffer.from([0, 0, 0, 4])]);
    padded[0] |= 0x20;
    padded.writeUInt16BE(3, 2);
    expect(parseVideoFeedback(Buffer.concat([report(), padded]), SSRC)).toHaveLength(2);
    expect(parseVideoFeedback(Buffer.concat([padded, report()]), SSRC)).toEqual([{ type: "malformed" }]);
  });

  test.each([
    Buffer.alloc(0), Buffer.from([128, 201, 0]), packet(201, 1, 8), packet(200, 0, 24),
    feedback(205, 1, 12), feedback(206, 1, 16), feedback(206, 4, 16),
    Buffer.concat([report(), Buffer.from([128])]), Buffer.alloc(65_540),
  ])("rejects malformed boundaries without partial reports or throwing", (buffer) => {
    expect(parseVideoFeedback(buffer, SSRC)).toEqual([{ type: "malformed" }]);
  });

  test("rejects wrong version, oversized lengths, invalid report counts and invalid padding", () => {
    const variants = [report(), report(), report(), report(), report()];
    variants[0][0] = 0x41;
    variants[1].writeUInt16BE(500, 2);
    variants[2][0] = 0x82;
    variants[3][0] |= 0x20;
    variants[3][variants[3].length - 1] = 0;
    variants[4][0] |= 0x20;
    variants[4][variants[4].length - 1] = 32;
    for (const buffer of variants) expect(parseVideoFeedback(buffer, SSRC)).toEqual([{ type: "malformed" }]);
  });
});
