// Deterministic rasterization of the launcher's small vector star mark.
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(((x + 0.5) * 64) / size - 32),
        dy = Math.abs(((y + 0.5) * 64) / size - 32);
      const outside =
        dx > 22 && dy > 22 && (dx - 22) ** 2 + (dy - 22) ** 2 > 9.5 ** 2;
      const star =
        dx / 20 + dy / 20 <= 1 && (Math.min(dx, dy) < 5 || dx + dy < 14);
      const color = outside
        ? [0, 0, 0, 0]
        : star
          ? [195, 155, 255, 255]
          : [22, 10, 44, 255];
      for (let c = 0; c < 4; c++)
        raw[y * (size * 4 + 1) + 1 + x * 4 + c] = color[c] ?? 0;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sizes = [16, 32, 64, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, size] of sizes.entries()) {
  const image = images[i];
  if (!image) throw new Error("Missing icon size");
  const at = 6 + i * 16;
  header[at] = size % 256;
  header[at + 1] = size % 256;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(image.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += image.length;
}
await Bun.write(`${root}/assets/icon.ico`, Buffer.concat([header, ...images]));
await Bun.write(`${root}/target/icon-preview.png`, png(256));
