import { inflateSync } from "node:zlib";
import { encodePng } from "./png.ts";

// Minimal PNG reader: returns IHDR fields and the inflated, de-filtered pixel
// rows so tests can assert exact channel mapping without a PNG dependency.
function decodePng(png: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  // One Buffer per row, filter byte stripped (encodePng only emits filter 0).
  rows: Buffer[];
} {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (!png.subarray(0, 8).equals(signature)) {
    throw new Error("bad PNG signature");
  }

  let offset = 8;
  let ihdr: Buffer | undefined;
  const idatParts: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") ihdr = Buffer.from(data);
    if (type === "IDAT") idatParts.push(Buffer.from(data));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!ihdr) throw new Error("missing IHDR");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colourType = ihdr[9];
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 0;
  if (channels === 0) {
    throw new Error(`unexpected colour type ${String(colourType)}`);
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    if (raw[start] !== 0) throw new Error("expected filter byte 0");
    rows.push(Buffer.from(raw.subarray(start + 1, start + 1 + stride)));
  }
  return { width, height, bitDepth, colourType, rows };
}

// Build an RGBA pixel buffer (R,G,B,X per pixel) from RGB triples — the order
// the screenshot path delivers. The X/alpha byte is deliberately 0, matching
// angrylion's uninitialised XRGB padding, so the test proves it is dropped.
function rgbaFrom(pixels: [number, number, number][]): Buffer {
  const buf = Buffer.alloc(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 0; // dead alpha
  });
  return buf;
}

describe("encodePng", () => {
  it("emits RGB (colour type 2) with no alpha channel", () => {
    const png = encodePng(rgbaFrom([[10, 20, 30]]), 1, 1);
    const { colourType, bitDepth, width, height } = decodePng(png);
    expect(colourType).toBe(2);
    expect(bitDepth).toBe(8);
    expect(width).toBe(1);
    expect(height).toBe(1);
  });

  it("writes RGBA source bytes to RGB output verbatim (colours unchanged)", () => {
    // red, green, blue, white as a 4x1 frame.
    const png = encodePng(
      rgbaFrom([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ]),
      4,
      1,
    );
    const { rows } = decodePng(png);
    expect([...rows[0]]).toEqual([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
  });

  it("drops the dead alpha byte so opaque output never goes transparent", () => {
    // Even with alpha=0 in the source, the encoded PNG has no alpha samples.
    const png = encodePng(rgbaFrom([[123, 45, 67]]), 1, 1);
    const { rows, colourType } = decodePng(png);
    expect(colourType).toBe(2);
    expect([...rows[0]]).toEqual([123, 45, 67]);
  });

  it("nearest-neighbour upscales by the integer scale factor", () => {
    const png = encodePng(
      rgbaFrom([
        [255, 0, 0],
        [0, 0, 255],
      ]),
      2,
      1,
      2,
    );
    const { width, height, rows } = decodePng(png);
    expect(width).toBe(4);
    expect(height).toBe(2);
    // Each source pixel becomes a 2x2 block; both rows identical.
    const expected = [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255];
    expect([...rows[0]]).toEqual(expected);
    expect([...rows[1]]).toEqual(expected);
  });
});
