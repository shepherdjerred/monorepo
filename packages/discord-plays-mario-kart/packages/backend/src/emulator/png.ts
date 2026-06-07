import { deflateSync } from "node:zlib";

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

// Encode a width x height RGBA frame to PNG, optionally nearest-neighbour
// upscaled by an integer factor for legibility on Discord. Dependency-free.
export function encodePng(
  rgba: Buffer,
  width: number,
  height: number,
  scale = 1,
): Buffer {
  const factor = Math.max(1, Math.floor(scale));
  const outW = width * factor;
  const outH = height * factor;

  const stride = outW * 4;
  const raw = Buffer.alloc((stride + 1) * outH);
  for (let y = 0; y < outH; y++) {
    const srcY = Math.trunc(y / factor);
    let pos = y * (stride + 1);
    raw[pos++] = 0; // filter: none
    for (let x = 0; x < outW; x++) {
      const srcX = Math.trunc(x / factor);
      const s = (srcY * width + srcX) * 4;
      raw[pos++] = rgba[s];
      raw[pos++] = rgba[s + 1];
      raw[pos++] = rgba[s + 2];
      raw[pos++] = rgba[s + 3];
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
