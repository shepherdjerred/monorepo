import { expect, test } from "bun:test";
import {
  readMovementRecords,
  MovementRecordError,
} from "./movement-records.mjs";

// Original649 plain vector, SR replay5669251769 at363.269775390625. Both
// original header readers preserve8472.5 bits; native positive/flag controls
// also preserve speeds above5000 through float32 maximum without clamping.
const vector = () =>
  Uint8Array.from(
    Buffer.from(
      "04031202004000620446006204460000000000000000000000000030354600c0b844000000000000000000000000000000000000000000000000010000000000000002470869f4df09b80403140200400022924400229244000000000000000000000000008843460000ed44000000000000000000000000000000000000000000000000010000000000000003120a3af53713",
      "hex",
    ),
  );

test("original high-speed motion records preserve header and motion values with exact vector closure", () => {
  const records = readMovementRecords(vector(), {
    deltaMode: "signed8",
    motionBlock: true,
  });
  expect(records.length).toBe(2);
  expect(records[0].entityId).toBe(1073742354);
  expect(records[0].recordType).toBe(772);
  expect(records[0].speed).toBe(8472.5);
  expect(records[0].motion.speed).toBe(8472.5);
  expect(records[0].encodedWaypoints.length).toBe(2);
  expect(records[1].encodedWaypoints.length).toBe(2);
});
test("native finite positive header domain has no arbitrary upper bound", () => {
  for (const speed of [
    0,
    5000,
    5000.5,
    10000,
    Math.fround(3.4028234663852886e38),
  ]) {
    const bytes = vector();
    new DataView(bytes.buffer).setFloat32(6, speed, true);
    expect(
      readMovementRecords(bytes, { deltaMode: "signed8", motionBlock: true })[0]
        .speed,
    ).toBe(speed);
  }
});
test("unsupported nonfinite and negative speeds retain exact diagnostic provenance", () => {
  for (const bits of [0x7fc00001, 0x7f800000, 0xbf800000]) {
    const bytes = vector();
    new DataView(bytes.buffer).setUint32(6, bits, true);
    try {
      readMovementRecords(bytes, { deltaMode: "signed8", motionBlock: true });
      throw Error("Expected speed boundary");
    } catch (error) {
      expect(error).toBeInstanceOf(MovementRecordError);
      expect(error.details).toMatchObject({
        recordOffset: 0,
        recordIndex: 0,
        recordType: 772,
        entityId: 1073742354,
        speedBits: bits,
      });
    }
  }
  expect(() =>
    readMovementRecords(vector().subarray(0, 146), {
      deltaMode: "signed8",
      motionBlock: true,
    }),
  ).toThrow("Truncated");
});
