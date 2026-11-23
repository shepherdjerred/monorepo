import { expect, test } from "bun:test";
import { readExactMapBin } from "./exact-map-bin.mjs";

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const u16 = (value) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
};
const f32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(value);
  return bytes;
};
function fixture({ wide = true, wrongWidth = false, duplicate = false } = {}) {
  const hash = Buffer.alloc(wide && !wrongWidth ? 8 : 4);
  if (hash.length === 8) hash.writeBigUInt64LE(0xfedcba9876543210n);
  else hash.writeUInt32LE(0x76543210);
  const first = Buffer.concat([u32(1), Buffer.from([17]), hash]);
  const next = Buffer.concat([
    u32(duplicate ? 1 : 2),
    Buffer.from([10]),
    f32(1.25),
  ]);
  const object = Buffer.concat([u32(0x12345678), u16(2), first, next]);
  return Buffer.concat([
    Buffer.from("PROP"),
    u32(3),
    u32(0),
    u32(1),
    u32(wide ? 0xff9d3409 : 0x11111111),
    u32(object.length),
    object,
  ]);
}

test("uses the observed class-specific 16.21 Hash64 width without numeric rounding", () => {
  const result = readExactMapBin(fixture());
  expect(result.objects[0].fields["00000001"]).toEqual({
    type: "Hash64",
    value: "18364758544493064720",
  });
  expect(result.objects[0].fields["00000002"]).toEqual({
    type: "F32",
    value: 1.25,
  });
  expect(result.hash64Fields).toHaveLength(1);
  expect(result.hash64Fields[0].ownerClass).toBe("ff9d3409");
});

test("captures exact original serialized field spans only when requested for native controls", () => {
  const bytes = fixture();
  const ordinary = readExactMapBin(bytes);
  const captured = readExactMapBin(bytes, "16.21.829.8620", {
    captureFieldSpans: true,
  });
  expect(ordinary.objects[0]).not.toHaveProperty("fieldSpans");
  expect(captured.objects[0].fields).toEqual(ordinary.objects[0].fields);
  expect(captured.objects[0].fieldSpans.map((span) => span.bytes)).toEqual([
    13, 9,
  ]);
  for (const span of captured.objects[0].fieldSpans) {
    expect(bytes.readUInt32LE(span.offset).toString(16).padStart(8, "0")).toBe(
      span.fieldHash,
    );
    expect(span.offset + span.bytes).toBeLessThanOrEqual(bytes.length);
  }
});

test("retains ordinary 32-bit Hash fields in other classes", () => {
  const result = readExactMapBin(fixture({ wide: false }));
  expect(result.objects[0].fields["00000001"]).toEqual({
    type: "Hash",
    value: 0x76543210,
  });
  expect(result.hash64Fields).toHaveLength(0);
});

test("rejects wrong-width data, duplicate fields and truncated or trailing bytes", () => {
  expect(() => readExactMapBin(fixture({ wrongWidth: true }))).toThrow();
  expect(() => readExactMapBin(fixture({ duplicate: true }))).toThrow(
    "Duplicate BIN field",
  );
  const bytes = fixture();
  expect(() => readExactMapBin(bytes.subarray(0, bytes.length - 1))).toThrow(
    "BIN bounds",
  );
  expect(() =>
    readExactMapBin(Buffer.concat([bytes, Buffer.from([0])])),
  ).toThrow("file length mismatch");
  const corrupt = Buffer.from(bytes);
  corrupt.writeUInt32LE(1, 20);
  expect(() => readExactMapBin(corrupt)).toThrow("object length mismatch");
});

test("rejects unadmitted versions, overrides, builds and unknown field types", () => {
  expect(() => readExactMapBin(fixture(), "16.22.834.8910")).toThrow(
    "Exact 16.21",
  );
  const bytes = fixture();
  bytes.writeUInt32LE(2, 4);
  expect(() => readExactMapBin(bytes)).toThrow("version 3");
  bytes.write("PTCH", 0);
  expect(() => readExactMapBin(bytes)).toThrow("patch overrides");
  const unsupported = fixture();
  unsupported[34] = 255;
  expect(() => readExactMapBin(unsupported)).toThrow("Unsupported BIN type");
});
