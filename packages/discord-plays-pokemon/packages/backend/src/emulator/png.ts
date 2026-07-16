import { deflateSync } from "node:zlib";
import { WIDTH, HEIGHT } from "./constants.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

// Encode a 240x160 RGBA frame to PNG, optionally nearest-neighbour upscaled by
// an integer factor for legibility on Discord. Dependency-free (node:zlib).
export function encodePng(rgba: Buffer, scale = 1): Buffer {
  const factor = Math.max(1, Math.floor(scale));
  const outW = WIDTH * factor;
  const outH = HEIGHT * factor;

  // Raw image data: each scanline prefixed with filter byte 0 (none).
  const stride = outW * 4;
  const raw = Buffer.alloc((stride + 1) * outH);
  for (let y = 0; y < outH; y++) {
    const srcY = Math.trunc(y / factor);
    let pos = y * (stride + 1);
    raw[pos++] = 0; // filter: none
    for (let x = 0; x < outW; x++) {
      const srcX = Math.trunc(x / factor);
      const s = (srcY * WIDTH + srcX) * 4;
      const r = rgba[s];
      const g = rgba[s + 1];
      const b = rgba[s + 2];
      const a = rgba[s + 3];
      if (
        r === undefined ||
        g === undefined ||
        b === undefined ||
        a === undefined
      ) {
        throw new Error(`RGBA source index out of range at ${String(s)}`);
      }
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
