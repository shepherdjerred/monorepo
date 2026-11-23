import { expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  precacheRmanRanges,
  planRmanRangeBatches,
} from "./rman-range-precache.mjs";
import { createRmanChunkReader } from "./rman-chunks.mjs";
const a = {
    id: 1n,
    bundleId: 3n,
    offset: 10,
    compressedSize: 4,
    uncompressedSize: 4,
  },
  b = { ...a, id: 2n, offset: 14 },
  bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const manifest = {
  manifestId: "B499FB04B1158CF6",
  sourceSha256: "a".repeat(64),
  bundles: [{ id: 3n, chunks: [a, b] }],
};
const reply = (data = bytes, range = "bytes 10-17/100") =>
  new Response(data, { status: 206, headers: { "content-range": range } });
const identity = (value) => value;
async function fixture(run) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, "scout-rman-batches-"));
  try {
    await run(root);
  } finally {
    const actual = await realpath(root);
    if (!actual.startsWith(parent + sep + "scout-rman-batches-"))
      throw Error("Unsafe fixture cleanup");
    await rm(actual, { recursive: true });
  }
}
const file = (root, id, extension) =>
  Bun.file(
    join(
      root,
      "chunks",
      manifest.manifestId,
      `${id.toString(16).toUpperCase().padStart(16, "0")}.${extension}`,
    ),
  );

test("one genuine parent range creates independently receipted exact chunks usable by strict reader", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(async () =>
      reply(),
    );
    try {
      const result = await precacheRmanRanges(
        manifest,
        root,
        [a, b, a],
        identity,
      );
      expect(result.newChunks).toBe(2);
      expect(result.batches).toHaveLength(1);
      expect(network).toHaveBeenCalledTimes(1);
      expect(network.mock.calls[0][1].headers.Range).toBe("bytes=10-17");
      const read = await createRmanChunkReader(manifest, root, identity);
      expect(await read(a)).toEqual(bytes.slice(0, 4));
      expect(await read(b)).toEqual(bytes.slice(4));
      expect(network).toHaveBeenCalledTimes(1);
      const receipt = await file(root, 2, "json").json();
      expect(receipt.rangeStart).toBe(14);
      expect(receipt.transport.rangeStart).toBe(10);
      expect(receipt.transport.rangeEnd).toBe(17);
      expect(receipt.compressedSha256).toBe(
        new Bun.CryptoHasher("sha256").update(bytes.slice(4)).digest("hex"),
      );
      expect(
        (await precacheRmanRanges(manifest, root, [a, b], identity)).batches,
      ).toHaveLength(0);
      expect(network).toHaveBeenCalledTimes(1);
    } finally {
      network.mockRestore();
    }
  }));

test("cached corruption is preserved and strict validation still rejects it", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(async () =>
      reply(),
    );
    try {
      // Seed one valid old exact-range receipt through the unchanged reader.
      network.mockImplementation(async () =>
        reply(bytes.slice(0, 4), "bytes 10-13/100"),
      );
      const read = await createRmanChunkReader(manifest, root, identity);
      await read(a);
      const old = await file(root, 1, "json").text();
      await Bun.write(file(root, 1, "bin"), new Uint8Array([9, 9, 9, 9]));
      network.mockImplementation(async () => reply());
      network.mockClear();
      await precacheRmanRanges(manifest, root, [a, b], identity);
      expect(await file(root, 1, "json").text()).toBe(old);
      expect(await file(root, 1, "bin").bytes()).toEqual(
        new Uint8Array([9, 9, 9, 9]),
      );
      await expect(read(a)).rejects.toThrow("SHA256 mismatch");
      expect(network).toHaveBeenCalledTimes(1);
    } finally {
      network.mockRestore();
    }
  }));

test("wrong HTTP ranges and any wrong expanded chunk prevent whole batch publication", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(async () =>
      reply(bytes, "bytes 11-18/100"),
    );
    try {
      await expect(
        precacheRmanRanges(manifest, root, [a, b], identity),
      ).rejects.toThrow("HTTP range differs");
      expect(await file(root, 1, "json").exists()).toBe(false);
      network.mockImplementation(async () => reply());
      await expect(
        precacheRmanRanges(manifest, root, [a, b], (data) =>
          data[0] === 5 ? new Uint8Array(3) : data,
        ),
      ).rejects.toThrow("expanded size differs");
      expect(await file(root, 1, "json").exists()).toBe(false);
      expect(await file(root, 1, "bin").exists()).toBe(false);
      expect(await file(root, 2, "json").exists()).toBe(false);
    } finally {
      network.mockRestore();
    }
  }));

test("source membership and contiguous/count/size bounds determine every transport range", () => {
  expect(() => planRmanRangeBatches(manifest, [{ ...b, offset: 15 }])).toThrow(
    "absent from original manifest",
  );
  expect(() =>
    planRmanRangeBatches({ ...manifest, sourceSha256: null }, [a]),
  ).toThrow("Hashed exact RMAN source");
  const chunks = Array.from({ length: 1025 }, (_, index) => ({
    ...a,
    id: BigInt(index + 1),
    offset: index * 4,
  }));
  const full = { ...manifest, bundles: [{ id: 3n, chunks }] };
  const batches = planRmanRangeBatches(full, chunks);
  expect(batches).toHaveLength(2);
  expect(batches[0].chunks).toHaveLength(1024);
  expect(batches[1].chunks).toHaveLength(1);
  const gap = { ...b, offset: 100 };
  expect(
    planRmanRangeBatches(
      { ...manifest, bundles: [{ id: 3n, chunks: [a, gap] }] },
      [a, gap],
    ),
  ).toHaveLength(2);
});
