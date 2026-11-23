// Sparse access to one immutable Riot RMAN/WAD. Format reference: CommunityDragon/CDTB.
import { resolve, sep } from "node:path";
import { createRmanChunkReader } from "./rman-chunks.mjs";

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
  const chunkData = await createRmanChunkReader(
    manifest,
    cacheRoot,
    decompress,
  );
  let position = 0;
  const chunks = file.chunks.map((c) => {
    const result = { ...c, start: position };
    position += c.uncompressedSize;
    return result;
  });
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
  const read = await readWad(name, range, decompress);
  read.rmanReceipts = () => chunkData.receipts();
  return read;
}

async function readWad(name, range, decompress) {
  const header = await range(0, 272);
  if (header[0] !== 82 || header[1] !== 87 || header[2] !== 3)
    throw Error("Unsupported WAD header");
  if (header[3] > 4) throw Error("Unadmitted WAD minor version");
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
      checksum: d.getBigUint64(o + 24, true),
    });
  }
  const lookup = (path) => {
    const e = entries.get(Bun.hash.xxHash64(path.toLowerCase()));
    if (!e) throw Error(`Missing WAD asset ${path}`);
    return e;
  };
  function verifyStored(e, data, label) {
    // WAD v3.1+ hashes the stored bytes, including compressed data. The exact
    // 16.21/v3.4 corpus independently agrees for plain and subchunked entries.
    const checksum =
      header[3] >= 1 ? Bun.hash.xxHash3(data) : Bun.hash.xxHash64(data);
    if (data.length !== e.compressed || checksum !== e.checksum)
      throw Error(`WAD entry integrity mismatch ${label}`);
  }
  async function simple(e, label) {
    const data = await range(e.offset, e.compressed);
    verifyStored(e, data, label);
    if (![0, 3].includes(e.type)) throw Error("Invalid simple WAD compression");
    const result = e.type === 0 ? data : decompress(data);
    if (result.length !== e.size) throw Error("WAD size mismatch");
    return result;
  }
  // Archives containing only raw/zstd entries have no subchunk table.
  // A table remains mandatory whenever a type-4 entry references it.
  const tocBytes = [...entries.values()].some((entry) => entry.type === 4)
    ? await simple(
        lookup(name.replace(/\.client$/i, ".subchunktoc")),
        "subchunk table",
      )
    : null;
  const toc = tocBytes
    ? new DataView(tocBytes.buffer, tocBytes.byteOffset, tocBytes.byteLength)
    : null;
  const readEntry = async (e, label) => {
    if (e.type !== 4) return simple(e, label);
    if (!toc) throw Error("Missing required WAD subchunk table");
    const data = await range(e.offset, e.compressed),
      output = new Uint8Array(e.size);
    verifyStored(e, data, label);
    let a = 0,
      b = 0;
    for (let i = 0; i < e.subchunks; i++) {
      const o = (e.first + i) * 16,
        cs = toc.getUint32(o, true),
        us = toc.getUint32(o + 4, true),
        hash = toc.getBigUint64(o + 8, true);
      const part = data.subarray(a, a + cs);
      if (part.length !== cs || Bun.hash.xxHash3(part) !== hash)
        throw Error(`WAD subchunk integrity mismatch ${label}`);
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
  const read = (path) => readEntry(lookup(path), path);
  read.byHash = (hash) => {
    if (typeof hash !== "bigint" || hash < 0n || hash > 0xffffffffffffffffn)
      throw Error("An exact unsigned 64-bit WAD path hash is required");
    const entry = entries.get(hash);
    if (!entry)
      throw Error(
        `Missing WAD path hash ${hash.toString(16).padStart(16, "0")}`,
      );
    return readEntry(entry, `hash:${hash.toString(16).padStart(16, "0")}`);
  };
  read.has = (path) => entries.has(Bun.hash.xxHash64(path.toLowerCase()));
  return read;
}
