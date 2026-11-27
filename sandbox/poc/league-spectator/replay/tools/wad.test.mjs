import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalWad } from "./wad.mjs";

test("reads exact 64-bit path hashes through the same bounded WAD entry path", async () => {
  const root = await mkdtemp(join(tmpdir(), "scout-wad-hash-"));
  const game = join(root, "Game"),
    file = join(game, "Map.wad.client");
  await mkdir(game);
  const hash = Bun.hash.xxHash64("assets/original/texture.tex");
  const bytes = Buffer.alloc(308);
  bytes.set([82, 87, 3, 4]);
  bytes.writeUInt32LE(1, 268);
  bytes.writeBigUInt64LE(hash, 272);
  bytes.writeUInt32LE(304, 280);
  bytes.writeUInt32LE(4, 284);
  bytes.writeUInt32LE(4, 288);
  bytes.set([1, 2, 3, 4], 304);
  bytes.writeBigUInt64LE(Bun.hash.xxHash3(bytes.subarray(304)), 296);
  await writeFile(file, bytes);
  try {
    const decompress = () => {
      throw Error("Unexpected decompression");
    };
    const indexSha256 = createHash("sha256")
      .update(bytes.subarray(0, 304))
      .digest("hex");
    const read = await openLocalWad(
      root,
      "Map.wad.client",
      decompress,
      indexSha256,
    );
    await expect(
      openLocalWad(root, "Map.wad.client", decompress, "0".repeat(64)),
    ).rejects.toThrow("WAD archive index differs from the pinned census");
    expect(await read.byHash(hash)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await read("assets/original/texture.tex")).toEqual(
      await read.byHash(hash),
    );
    expect(() => read.byHash(Number(hash))).toThrow("exact unsigned 64-bit");
    expect(() => read.byHash(-1n)).toThrow("exact unsigned 64-bit");
    expect(() => read.byHash(1n)).toThrow("Missing WAD path hash");
  } finally {
    await unlink(file);
    await rmdir(game);
    await rmdir(root);
  }
});

for (const type of [0, 3]) {
  test(`rejects same-length corruption of stored ${type === 3 ? "zstd" : "raw"} WAD bytes before decompression`, async () => {
    const root = await mkdtemp(join(tmpdir(), "scout-wad-integrity-"));
    const game = join(root, "Game"),
      file = join(game, "Map.wad.client");
    await mkdir(game);
    const raw = new Uint8Array([1, 2, 3, 4]);
    const stored = type === 3 ? Bun.zstdCompressSync(raw) : raw;
    const bytes = Buffer.alloc(304 + stored.length);
    bytes.set([82, 87, 3, 4]);
    bytes.writeUInt32LE(1, 268);
    bytes.writeBigUInt64LE(Bun.hash.xxHash64("original"), 272);
    bytes.writeUInt32LE(304, 280);
    bytes.writeUInt32LE(stored.length, 284);
    bytes.writeUInt32LE(raw.length, 288);
    bytes[292] = type;
    bytes.writeBigUInt64LE(Bun.hash.xxHash3(stored), 296);
    bytes.set(stored, 304);
    await writeFile(file, bytes);
    let decompressions = 0;
    const decompress = (value) => {
      decompressions++;
      return Bun.zstdDecompressSync(value);
    };
    try {
      const read = await openLocalWad(root, "Map.wad.client", decompress);
      expect(await read("original")).toEqual(raw);
      bytes[bytes.length - 1] ^= 1;
      await writeFile(file, bytes);
      decompressions = 0;
      await expect(read("original")).rejects.toThrow(
        "WAD entry integrity mismatch",
      );
      expect(decompressions).toBe(0);
    } finally {
      await unlink(file);
      await rmdir(game);
      await rmdir(root);
    }
  });
}
