// Sparse access to one immutable Riot RMAN/WAD. Format reference: CommunityDragon/CDTB.
import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";

export async function openLocalWad(installation, name, decompress) {
  const root = resolve(installation, "Game");
  const path = resolve(root, name);
  if (!path.startsWith(root + sep))
    throw Error("WAD path outside installation Game directory");
  const file = Bun.file(path);
  if (!(await file.exists())) throw Error(`Missing installed WAD ${name}`);
  async function range(start, length) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      start + length > file.size
    )
      throw Error("WAD range outside file");
    const bytes = new Uint8Array(
      await file.slice(start, start + length).arrayBuffer(),
    );
    if (bytes.length !== length)
      throw Error("Installed WAD changed or was truncated during read");
    return bytes;
  }
  return readWad(name, range, decompress);
}

export async function openWad(manifest, name, cacheRoot, decompress) {
  const file = manifest.files.find(
    (f) => f.name.toLowerCase() === name.toLowerCase(),
  );
  if (!file) throw Error(`Missing manifest file ${name}`);
  await mkdir(`${cacheRoot}/chunks`, { recursive: true });
  let position = 0;
  const chunks = file.chunks.map((c) => {
    const result = { ...c, start: position };
    position += c.uncompressedSize;
    return result;
  });
  async function chunkData(c) {
    const cache = Bun.file(`${cacheRoot}/chunks/${c.id}.bin`);
    let data;
    if (await cache.exists()) data = new Uint8Array(await cache.arrayBuffer());
    else {
      const id = c.bundleId.toString(16).toUpperCase().padStart(16, "0");
      const response = await fetch(
        `https://lol.dyn.riotcdn.net/channels/public/bundles/${id}.bundle`,
        {
          headers: {
            Range: `bytes=${c.offset}-${c.offset + c.compressedSize - 1}`,
          },
        },
      );
      if (response.status !== 206)
        throw Error(`Bundle ${id}: expected HTTP 206, got ${response.status}`);
      const compressed = new Uint8Array(await response.arrayBuffer());
      if (compressed.length !== c.compressedSize)
        throw Error("Invalid bundle range length");
      data = decompress(compressed);
    }
    if (data.length !== c.uncompressedSize)
      throw Error(`Invalid RMAN chunk length ${c.id}`);
    if (!(await cache.exists())) await Bun.write(cache, data);
    return data;
  }
  async function range(start, length) {
    if (start < 0 || length < 0 || start + length > position)
      throw Error("WAD range outside file");
    const selected = chunks.filter(
      (c) => c.start < start + length && c.start + c.uncompressedSize > start,
    );
    const output = new Uint8Array(length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(12, selected.length) }, async () => {
        while (next < selected.length) {
          const c = selected[next++],
            data = await chunkData(c);
          const lo = Math.max(start, c.start),
            hi = Math.min(start + length, c.start + c.uncompressedSize);
          output.set(data.subarray(lo - c.start, hi - c.start), lo - start);
        }
      }),
    );
    return output;
  }
  return readWad(name, range, decompress);
}

async function readWad(name, range, decompress) {
  const header = await range(0, 272);
  if (header[0] !== 82 || header[1] !== 87 || header[2] !== 3)
    throw Error("Unsupported WAD header");
  const count = new DataView(header.buffer).getUint32(268, true);
  if (count > 1000000) throw Error("Invalid WAD index size");
  const index = await range(272, count * 32),
    d = new DataView(index.buffer),
    entries = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * 32;
    entries.set(d.getBigUint64(o, true), {
      offset: d.getUint32(o + 8, true),
      compressed: d.getUint32(o + 12, true),
      size: d.getUint32(o + 16, true),
      type: d.getUint8(o + 20) & 15,
      subchunks: d.getUint8(o + 20) >> 4,
      first:
        d.getUint16(o + 22, true) +
        (header[3] >= 4 ? d.getUint8(o + 21) * 65536 : 0),
    });
  }
  const lookup = (path) => {
    const e = entries.get(Bun.hash.xxHash64(path.toLowerCase()));
    if (!e) throw Error(`Missing WAD asset ${path}`);
    return e;
  };
  async function simple(e) {
    const data = await range(e.offset, e.compressed);
    if (![0, 3].includes(e.type)) throw Error("Invalid simple WAD compression");
    const result = e.type === 0 ? data : decompress(data);
    if (result.length !== e.size) throw Error("WAD size mismatch");
    return result;
  }
  // Archives containing only raw/zstd entries have no subchunk table.
  // A table remains mandatory whenever a type-4 entry references it.
  const tocBytes = [...entries.values()].some((entry) => entry.type === 4)
    ? await simple(lookup(name.replace(/\.client$/i, ".subchunktoc")))
    : null;
  const toc = tocBytes
    ? new DataView(tocBytes.buffer, tocBytes.byteOffset, tocBytes.byteLength)
    : null;
  const read = async (path) => {
    const e = lookup(path);
    if (e.type !== 4) return simple(e);
    if (!toc) throw Error("Missing required WAD subchunk table");
    const data = await range(e.offset, e.compressed),
      output = new Uint8Array(e.size);
    let a = 0,
      b = 0;
    for (let i = 0; i < e.subchunks; i++) {
      const o = (e.first + i) * 16,
        cs = toc.getUint32(o, true),
        us = toc.getUint32(o + 4, true),
        hash = toc.getBigUint64(o + 8, true);
      const part = data.subarray(a, a + cs);
      if (part.length !== cs || Bun.hash.xxHash3(part) !== hash)
        throw Error(`WAD subchunk integrity mismatch ${path}`);
      const raw = cs === us ? part : decompress(part);
      if (raw.length !== us) throw Error("Invalid WAD subchunk length");
      output.set(raw, b);
      a += cs;
      b += us;
    }
    if (a !== data.length || b !== e.size)
      throw Error("WAD subchunk totals mismatch");
    return output;
  };
  read.has = (path) => entries.has(Bun.hash.xxHash64(path.toLowerCase()));
  return read;
}
