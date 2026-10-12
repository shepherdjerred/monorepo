import { inflateSync } from "node:zlib";

/** Walk the chunk list, keeping IHDR and the IDAT payloads. */
function readChunks(png: Buffer): {
  ihdr: Buffer | undefined;
  idatParts: Buffer[];
} {
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
  return { ihdr, idatParts };
}

// Minimal PNG reader for the encoder in ./png.ts: returns IHDR fields and the
// inflated, de-filtered pixel rows so tests in either game can assert exact
// channel mapping without a PNG dependency. Handles only what encodePng emits.
export function decodePng(png: Buffer): {
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

  const { ihdr, idatParts } = readChunks(png);
  if (!ihdr) throw new Error("missing IHDR");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colourType = ihdr.readUInt8(9);
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

/** One decoded row, failing loudly when the image is shorter than expected. */
export function pngRow(rows: readonly Buffer[], y: number): Buffer {
  const row = rows[y];
  if (row === undefined) throw new Error(`PNG has no row ${String(y)}`);
  return row;
}

/**
 * Build an RGBA pixel buffer (R,G,B,X per pixel) from RGB triples, the order
 * the screenshot paths deliver. The X/alpha byte is deliberately 0, so a test
 * can prove the encoder drops it.
 */
export function rgbaFromRgb(
  pixels: readonly [number, number, number][],
): Buffer {
  const buf = Buffer.alloc(pixels.length * 4);
  for (const [i, [r, g, b]] of pixels.entries()) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
  }
  return buf;
}
