import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { installAssetFiles } from "#src/render/asset-cache.ts";

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
