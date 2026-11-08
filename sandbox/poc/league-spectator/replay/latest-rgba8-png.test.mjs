import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodeLatestRgba8Png } from "./latest-rgba8-png.mjs";
const crc = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
};
function chunk(name, data) {
  const bytes = new Uint8Array(data.length + 12),
    view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(name), 4);
  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}
function png(
  raw,
  { width = 1, height = 1, color = 6, interlace = 0, extra = [] } = {},
) {
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = color;
  header[12] = interlace;
  const parts = [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      ...extra,
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array()),
    ],
    output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
test("all five native PNG filters preserve channels, transparency and row order", async () => {
  const expected = Uint8Array.from([
    10, 30, 90, 255, 40, 70, 120, 0, 60, 80, 100, 128, 90, 100, 110, 1,
  ]);
  for (let filter = 0; filter <= 4; filter++) {
    const rows = new Uint8Array(18);
    for (let y = 0; y < 2; y++) {
      rows[y * 9] = filter;
      for (let x = 0; x < 8; x++) {
        const offset = y * 8 + x,
          a = x < 4 ? 0 : expected[offset - 4],
          b = y ? expected[offset - 8] : 0,
          c = y && x >= 4 ? expected[offset - 12] : 0,
          p = a + b - c,
          distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)],
          predictor =
            filter === 0
              ? 0
              : filter === 1
                ? a
                : filter === 2
                  ? b
                  : filter === 3
                    ? Math.floor((a + b) / 2)
                    : distances[0] <= distances[1] &&
                        distances[0] <= distances[2]
                      ? a
                      : distances[1] <= distances[2]
                        ? b
                        : c;
        rows[y * 9 + x + 1] = (expected[offset] - predictor) & 255;
      }
    }
    const result = await decodeLatestRgba8Png(
      png(rows, { width: 2, height: 2 }),
    );
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data).toEqual(expected);
  }
});
test("invalid CRC, unsupported format, animation and inflate size cannot receive substituted pixels", async () => {
  const good = png(Uint8Array.from([0, 1, 2, 3, 4])),
    badCrc = good.slice();
  badCrc[30] ^= 1;
  for (const bad of [
    badCrc,
    png(Uint8Array.from([0, 1, 2, 3, 4]), { color: 2 }),
    png(Uint8Array.from([0, 1, 2, 3, 4]), { interlace: 1 }),
    png(Uint8Array.from([0, 1, 2, 3, 4]), {
      extra: [chunk("acTL", new Uint8Array(8))],
    }),
    png(new Uint8Array(4)),
    png(new Uint8Array(6)),
    png(Uint8Array.from([5, 1, 2, 3, 4])),
    good.subarray(0, good.length - 1),
  ])
    await expect(decodeLatestRgba8Png(bad)).rejects.toThrow();
});
