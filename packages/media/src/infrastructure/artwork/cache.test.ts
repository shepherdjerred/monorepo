import { mkdir, readdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  artworkFixture,
  artworkRoot,
  jpeg,
  posterName,
  removeArtworkFixtures,
} from "./artwork.test-support.ts";

afterEach(removeArtworkFixtures);

async function listing(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.toSorted();
}

/** Writes cache files directly, oldest first, as an earlier process would have. */
async function seed(root: string, names: string[]): Promise<void> {
  await mkdir(path.join(root, "w342"), { recursive: true });
  for (const [index, name] of names.entries()) {
    const target = path.join(root, "w342", name);
    await writeFile(target, jpeg(40));
    await utimes(target, 1000 + index, 1000 + index);
  }
}

describe("artwork disk cache", () => {
  test("creates a missing directory with its parents and leaves it empty", async () => {
    const root = path.join(await artworkRoot(), "absent", "artwork");
    const { cache } = await artworkFixture({ root });
    expect(await listing(root)).toEqual([]);
    await cache.write("w342", posterName(1), jpeg(40));
    expect(await listing(path.join(root, "w342"))).toEqual([posterName(1)]);
  });

  test("refuses a path that is a file and a path that cannot be created", async () => {
    const root = await artworkRoot();
    await writeFile(path.join(root, "file"), "x");
    await expect(
      artworkFixture({ root: path.join(root, "file") }),
    ).rejects.toThrow("cannot be created or is not writable");
    await expect(
      artworkFixture({ root: path.join(root, "file", "artwork") }),
    ).rejects.toThrow("cannot be created or is not writable");
    expect(await listing(root)).toEqual(["file"]);
  });

  test("stores each image at <root>/<size>/<file> and leaves no temporary file", async () => {
    const { cache, root } = await artworkFixture();
    expect(cache.stored()).toBeNull();
    expect(await cache.read("w342", posterName(1))).toBeNull();
    await cache.write("w342", posterName(1), jpeg(40));
    await cache.write("w780", posterName(1), jpeg(60));
    expect(await listing(root)).toEqual(["w342", "w780"]);
    expect(await listing(path.join(root, "w342"))).toEqual([posterName(1)]);
    expect(await cache.read("w780", posterName(1))).toEqual(jpeg(60));
    expect(cache.stored()).toEqual({ entries: 2, bytes: 100 });
    await cache.write("w342", posterName(1), jpeg(10));
    expect(cache.stored()).toEqual({ entries: 2, bytes: 70 });
  });

  test("evicts the least recently used entries on write and reports them", async () => {
    const { cache, root, log } = await artworkFixture({ maximumBytes: 100 });
    await cache.write("w342", posterName(1), jpeg(40));
    await cache.write("w342", posterName(2), jpeg(40));
    const target = path.join(root, "w342", posterName(1));
    const before = await stat(target);
    expect(await cache.read("w342", posterName(1))).toEqual(jpeg(40));
    const after = await stat(target);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await cache.write("w342", posterName(3), jpeg(40));
    expect(await listing(path.join(root, "w342"))).toEqual([
      posterName(1),
      posterName(3),
    ]);
    expect(cache.stored()).toEqual({ entries: 2, bytes: 80 });
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: "media_artwork_cache_evicted",
      entries: 1,
      bytes: 40,
    });
    await cache.write("w342", posterName(4), jpeg(100));
    expect(await listing(path.join(root, "w342"))).toEqual([posterName(4)]);
  });

  test("rebuilds the index from one scan, oldest file first, and clears abandoned writes", async () => {
    const root = await artworkRoot();
    await seed(root, [posterName(2), posterName(1), posterName(3)]);
    await writeFile(path.join(root, "w342", ".writing-abandoned"), "partial");
    await writeFile(path.join(root, "w342", "notes.txt"), "not artwork");
    const { cache } = await artworkFixture({ root, maximumBytes: 130 });
    await cache.write("w342", posterName(4), jpeg(40));
    expect(await listing(path.join(root, "w342"))).toEqual([
      posterName(1),
      posterName(3),
      posterName(4),
      "notes.txt",
    ]);
    expect(cache.stored()).toEqual({ entries: 3, bytes: 120 });
  });

  test.each([
    ["empty", new Uint8Array()],
    ["signature", new TextEncoder().encode("<html>not an image</html>")],
  ])("reports and removes a cached file that is %s", async (reason, bytes) => {
    const root = await artworkRoot();
    await seed(root, [posterName(1)]);
    await writeFile(path.join(root, "w342", posterName(1)), bytes);
    const { cache, log } = await artworkFixture({ root });
    expect(await cache.read("w342", posterName(1))).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: "media_artwork_cache_corrupt",
      key: `w342/${posterName(1)}`,
      reason,
    });
    expect(await listing(path.join(root, "w342"))).toEqual([]);
    expect(cache.stored()).toEqual({ entries: 0, bytes: 0 });
  });
});
