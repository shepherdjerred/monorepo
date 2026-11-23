import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createRmanChunkReader } from "./rman-chunks.mjs";

const manifest = {
  manifestId: "B499FB04B1158CF6",
  sourceSha256: "a".repeat(64),
};
const chunk = {
  id: 1n,
  bundleId: 2n,
  offset: 10,
  compressedSize: 4,
  uncompressedSize: 4,
};
const original = new Uint8Array([1, 2, 3, 4]);
const response = (bytes = original, range = "bytes 10-13/100") =>
  new Response(bytes, {
    status: 206,
    headers: { "content-range": range },
  });
async function fixture(run) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "scout-rman-receipts-"));
  try {
    await run(root);
  } finally {
    const actual = await realpath(root);
    if (!actual.startsWith(parent + sep + "scout-rman-receipts-"))
      throw Error("Unsafe test cleanup");
    await rm(actual, { recursive: true });
  }
}
const cacheFiles = (root) => {
  const directory = join(root, "chunks", manifest.manifestId);
  return {
    directory,
    payload: Bun.file(join(directory, "0000000000000001.bin")),
    receipt: Bun.file(join(directory, "0000000000000001.json")),
  };
};

test("refetches unreceipted legacy bytes once and binds reuse to exact release/range/SHA", async () => {
  await fixture(async (root) => {
    const files = cacheFiles(root);
    await mkdir(files.directory, { recursive: true });
    await Bun.write(
      join(root, "chunks", "1.bin"),
      new Uint8Array([9, 9, 9, 9]),
    );
    await Bun.write(files.payload, new Uint8Array([8, 8, 8, 8]));
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      async (_url, options) => {
        expect(options.headers.Range).toBe("bytes=10-13");
        return response();
      },
    );
    try {
      const read = await createRmanChunkReader(
        manifest,
        root,
        (bytes) => bytes,
      );
      const [first, concurrent] = await Promise.all([read(chunk), read(chunk)]);
      expect(first).toEqual(original);
      expect(concurrent).toEqual(original);
      expect(await read(chunk)).toEqual(original);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const receipt = await files.receipt.json();
      expect(receipt).toMatchObject({
        manifestId: manifest.manifestId,
        sourceManifestSha256: manifest.sourceSha256,
        chunkId: "0000000000000001",
        bundleId: "0000000000000002",
        rangeStart: 10,
        rangeEnd: 13,
        compressedBytes: 4,
        uncompressedBytes: 4,
      });
      expect(receipt.sha256).toBe(
        new Bun.CryptoHasher("sha256").update(original).digest("hex"),
      );
      expect(read.receipts()).toEqual([receipt]);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

test("existing receipt corruption or identity mismatch fails without a network fallback", async () => {
  await fixture(async (root) => {
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () =>
      response(),
    );
    try {
      const read = await createRmanChunkReader(
        manifest,
        root,
        (bytes) => bytes,
      );
      await read(chunk);
      const files = cacheFiles(root);
      await Bun.write(files.payload, new Uint8Array([1, 2, 3, 9]));
      fetchMock.mockClear();
      await expect(read(chunk)).rejects.toThrow("SHA256 mismatch");
      await Bun.write(files.payload, original);
      await expect(read({ ...chunk, offset: 11 })).rejects.toThrow(
        "receipt identity mismatch",
      );
      const changedSource = await createRmanChunkReader(
        { ...manifest, sourceSha256: "b".repeat(64) },
        root,
        (bytes) => bytes,
      );
      await expect(changedSource(chunk)).rejects.toThrow(
        "receipt identity mismatch",
      );
      await Bun.write(files.receipt, "{");
      await expect(read(chunk)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});

test("rejects wrong ranges, excess/truncated response bytes, and wrong expanded sizes without receipts", async () => {
  await fixture(async (root) => {
    const replies = [
      response(original, "bytes 11-14/100"),
      response(new Uint8Array(5)),
      response(new Uint8Array(3)),
      response(),
    ];
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () =>
      replies.shift(),
    );
    try {
      const read = await createRmanChunkReader(
        manifest,
        root,
        () => new Uint8Array(3),
      );
      await expect(read(chunk)).rejects.toThrow("Content-Range");
      await expect(read(chunk)).rejects.toThrow("exceeded exact range");
      await expect(read(chunk)).rejects.toThrow("Truncated bundle range");
      await expect(read(chunk)).rejects.toThrow("Invalid RMAN chunk length");
      expect(await cacheFiles(root).receipt.exists()).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
