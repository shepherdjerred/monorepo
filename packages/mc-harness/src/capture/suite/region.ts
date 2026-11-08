import { gunzipSync, inflateSync } from "node:zlib";
import { validateNbt } from "./nbt.ts";

function validatePayload(
  codec: number,
  payload: Buffer,
  chunk: { x: number; z: number; layer: "region" | "entities" | "poi" },
): void {
  const options = { maxOutputLength: 64 * 1024 * 1024 };
  switch (codec) {
    case 1:
      validateNbt(gunzipSync(payload, options), chunk);
      return;
    case 2:
      validateNbt(inflateSync(payload, options), chunk);
      return;
    case 3:
      validateNbt(payload, chunk);
      return;
    default:
      throw new Error(`Unsupported chunk codec ${codec.toString()}`);
  }
}

/** Extract complete native chunk records; never modify or pad a source region. */
export function cropRegion(
  source: Uint8Array,
  region: { x: number; z: number; layer: "region" | "entities" | "poi" },
  contains: (chunkX: number, chunkZ: number) => boolean,
): Buffer {
  const input = Buffer.from(source);
  if (input.length < 8192) throw new Error("Invalid region length");
  const header = Buffer.alloc(8192);
  const records: Buffer[] = [header];
  let nextSector = 2;
  const occupied = new Set<number>();
  for (let index = 0; index < 1024; index++) {
    const address = input.readUInt32BE(index * 4);
    if (address === 0) continue;
    const offset = address >>> 8,
      sectors = address & 255;
    if (sectors === 0 || offset < 2 || offset * 4096 + 5 > input.length)
      throw new Error("Chunk exceeds region bounds");
    for (let sector = offset; sector < offset + sectors; sector++) {
      if (occupied.has(sector)) throw new Error("Overlapping chunk sectors");
      occupied.add(sector);
    }
    const start = offset * 4096,
      length = input.readUInt32BE(start);
    if (
      length < 2 ||
      length + 4 > sectors * 4096 ||
      start + 4 + length > input.length
    )
      throw new Error("Invalid chunk payload length");
    const codec = input.readUInt8(start + 4);
    const payload = input.subarray(start + 5, start + 4 + length);
    const x = region.x * 32 + (index % 32),
      z = region.z * 32 + Math.floor(index / 32);
    validatePayload(codec, payload, { x, z, layer: region.layer });
    if (!contains(x, z)) continue;
    const required = Math.ceil((length + 4) / 4096);
    header.writeUInt32BE(nextSector * 256 + required, index * 4);
    input.copy(header, 4096 + index * 4, 4096 + index * 4, 4100 + index * 4);
    const record = Buffer.alloc(required * 4096);
    input.copy(record, 0, start, start + length + 4);
    records.push(record);
    nextSector += required;
  }
  return Buffer.concat(records);
}
