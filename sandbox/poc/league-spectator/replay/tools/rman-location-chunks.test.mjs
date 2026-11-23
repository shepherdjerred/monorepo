import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createRmanChunkReader } from "./rman-chunks.mjs";
import { createLocationScopedRmanChunkReader } from "./rman-location-chunks.mjs";

const a = {
  id: 1n,
  bundleId: 2n,
  offset: 10,
  compressedSize: 4,
  uncompressedSize: 4,
};
const b = { ...a, bundleId: 3n, offset: 20 };
const bytes = new Uint8Array([1, 2, 3, 4]);
const manifest = {
  manifestId: "B499FB04B1158CF6",
  sourceSha256: "a".repeat(64),
  bundles: [
    { id: 2n, chunks: [a] },
    { id: 3n, chunks: [b] },
  ],
};
const response = (offset) =>
  new Response(bytes, {
    status: 206,
    headers: { "content-range": `bytes ${offset}-${offset + 3}/100` },
  });
const identity = (value) => value;
async function fixture(run) {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, "scout-location-chunks-"));
  try {
    await run(root);
  } finally {
    const actual = await realpath(root);
    if (!actual.startsWith(parent + sep + "scout-location-chunks-"))
      throw Error("Unsafe fixture cleanup");
    await rm(actual, { recursive: true });
  }
}
const legacyFile = (root, extension) =>
  Bun.file(
    join(root, "chunks", manifest.manifestId, `0000000000000001.${extension}`),
  );

test("preserves valid old-location receipt, fetches exact new location once and reuses both", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(
      async (_url, options) =>
        response(options.headers.Range === "bytes=10-13" ? 10 : 20),
    );
    try {
      const legacy = await createRmanChunkReader(manifest, root, identity);
      await legacy(a);
      const before = await legacyFile(root, "json").text();
      const read = await createLocationScopedRmanChunkReader(
        manifest,
        root,
        identity,
      );
      network.mockClear();
      expect(await read(a)).toEqual(bytes);
      expect(network).not.toHaveBeenCalled();
      const [first, concurrent] = await Promise.all([read(b), read(b)]);
      expect(first).toEqual(bytes);
      expect(concurrent).toEqual(bytes);
      expect(network).toHaveBeenCalledTimes(1);
      expect(network.mock.calls[0][1].headers.Range).toBe("bytes=20-23");
      expect(await legacyFile(root, "json").text()).toBe(before);
      expect(await legacyFile(root, "bin").bytes()).toEqual(bytes);
      const fresh = await createLocationScopedRmanChunkReader(
        manifest,
        root,
        identity,
      );
      expect(await fresh(b)).toEqual(bytes);
      expect(network).toHaveBeenCalledTimes(1);
      expect(read.receipts().map((row) => row.bundleId)).toEqual([
        "0000000000000002",
        "0000000000000003",
      ]);
      // The old API still rejects this conflicting location: its gate is intact.
      await expect(legacy(b)).rejects.toThrow("receipt identity mismatch");
    } finally {
      network.mockRestore();
    }
  }));

test("concurrent distinct locations without legacy bytes never collide", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(
      async (_url, options) =>
        response(options.headers.Range === "bytes=10-13" ? 10 : 20),
    );
    try {
      const read = await createLocationScopedRmanChunkReader(
        manifest,
        root,
        identity,
      );
      expect(await Promise.all([read(a), read(b), read(a), read(b)])).toEqual([
        bytes,
        bytes,
        bytes,
        bytes,
      ]);
      expect(network).toHaveBeenCalledTimes(2);
      expect(await legacyFile(root, "json").exists()).toBe(false);
      expect(read.receipts()).toHaveLength(2);
      const fresh = await createLocationScopedRmanChunkReader(
        manifest,
        root,
        identity,
      );
      await fresh(a);
      await fresh(b);
      expect(network).toHaveBeenCalledTimes(2);
      await Bun.write(
        join(
          root,
          "source-locations",
          "0000000000000001-0000000000000003-20-4-4",
          "chunks",
          manifest.manifestId,
          "0000000000000001.bin",
        ),
        new Uint8Array([9, 9, 9, 9]),
      );
      await expect(fresh(b)).rejects.toThrow("SHA256 mismatch");
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      network.mockRestore();
    }
  }));

test("unadmitted locations, changed source, corrupt legacy bytes and forged membership fail without fetch", async () =>
  fixture(async (root) => {
    const network = spyOn(globalThis, "fetch").mockImplementation(async () =>
      response(10),
    );
    try {
      await (
        await createRmanChunkReader(manifest, root, identity)
      )(a);
      network.mockClear();
      const read = await createLocationScopedRmanChunkReader(
        manifest,
        root,
        identity,
      );
      await expect(read({ ...b, offset: 21 })).rejects.toThrow(
        "absent from exact source",
      );
      const changed = await createLocationScopedRmanChunkReader(
        { ...manifest, sourceSha256: "b".repeat(64) },
        root,
        identity,
      );
      await expect(changed(b)).rejects.toThrow("source membership mismatch");
      await Bun.write(legacyFile(root, "bin"), new Uint8Array([9, 9, 9, 9]));
      await expect(read(b)).rejects.toThrow("SHA256 mismatch");
      await Bun.write(legacyFile(root, "bin"), bytes);
      const receipt = await legacyFile(root, "json").json();
      receipt.rangeStart = 11;
      receipt.rangeEnd = 14;
      await Bun.write(legacyFile(root, "json"), JSON.stringify(receipt));
      await expect(read(b)).rejects.toThrow("source membership mismatch");
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  }));
