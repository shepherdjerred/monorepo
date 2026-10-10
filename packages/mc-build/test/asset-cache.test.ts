import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { assetCacheReady, installAssetFiles } from "#src/render/asset-cache.ts";

test("cache preflight distinguishes missing, complete and corrupt caches without changing bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mc-cache-preflight-"));
  const root = path.join(dir, "assets");
  try {
    expect(await assetCacheReady(root)).toBe(false);
    await mkdir(root);
    const file = path.join(root, "partial-model.json");
    await Bun.write(file, "original partial model");
    await expect(assetCacheReady(root)).rejects.toThrow(
      `incomplete Minecraft asset cache at ${root}`,
    );
    await Bun.write(path.join(root, ".complete"), "invalid digest\n");
    await expect(assetCacheReady(root)).rejects.toThrow(
      /incomplete Minecraft asset cache/u,
    );
    expect(await Bun.file(file).text()).toBe("original partial model");
    expect(await Bun.file(path.join(root, ".complete")).text()).toBe(
      "invalid digest\n",
    );
    await Bun.write(path.join(root, ".complete"), `${"a".repeat(40)}\n`);
    expect(await assetCacheReady(root)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parallel initializers publish only complete packs and preserve active readers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mc-cache-race-"));
  try {
    const root = path.join(dir, "assets");
    const files = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `models/${index.toString()}.json`,
        new TextEncoder().encode(`model-${index.toString()}`),
      ]),
    );
    await Promise.all(
      Array.from({ length: 8 }, () =>
        installAssetFiles(root, files, "same-digest"),
      ),
    );
    for (const [name, bytes] of Object.entries(files))
      expect(await Bun.file(path.join(root, name)).bytes()).toEqual(bytes);
    await Promise.all([
      installAssetFiles(root, files, "same-digest"),
      ...Array.from({ length: 20 }, async () => {
        expect(await Bun.file(path.join(root, ".complete")).text()).toBe(
          "same-digest\n",
        );
        expect(await Bun.file(path.join(root, "models/0.json")).text()).toBe(
          "model-0",
        );
      }),
    ]);
    expect(await readdir(dir)).toEqual(["assets"]);
    await expect(
      installAssetFiles(root, files, "another-digest"),
    ).rejects.toThrow();
    expect(await Bun.file(path.join(root, ".complete")).text()).toBe(
      "same-digest\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
