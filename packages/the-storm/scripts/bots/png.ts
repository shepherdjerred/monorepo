/**
 * A dependency-free PNG encoder for 64x64 RGBA skins, and the hash that
 * identifies a skin's pixels in the manifest and the texture cache.
 */

/** Skins are 64x64 texture pixels. */
export const SIZE = 64;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** A 64x64 RGBA PNG (8-bit, colour type 6, filter 0 on every scanline). */
export function encodePng(rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  if (rgba.length !== SIZE * SIZE * 4) {
    throw new Error(
      `expected ${String(SIZE * SIZE * 4)} bytes, got ${String(rgba.length)}`,
    );
  }
  const stride = SIZE * 4 + 1;
  const raw = new Uint8Array(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * stride + 1);
  }
  const deflated = Bun.deflateSync(raw, { level: 9 });
  const zlib = concat([
    new Uint8Array([0x78, 0xda]),
    deflated,
    u32(adler32(raw)),
  ]);
  const header = concat([
    u32(SIZE),
    u32(SIZE),
    new Uint8Array([8, 6, 0, 0, 0]),
  ]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
