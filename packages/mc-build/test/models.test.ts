import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { assetCacheReady, installAssetFiles } from "#src/render/asset-cache.ts";
import { encodePng, Renderer } from "#src/render/index.ts";
import { ModelResolver } from "#src/render/models.ts";
import { Image } from "#src/render/raster.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "mc-model-payload-"));
afterAll(async () => rm(root, { recursive: true }));
const json = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const base = "assets/minecraft/";
const image = new Image(16, 16, [130, 140, 150, 255]);
const files = {
  [`${base}blockstates/stone.json`]: json({
    variants: { "": { model: "block/stone" } },
  }),
  [`${base}models/block/stone.json`]: json({ parent: "block/base" }),
  [`${base}models/block/base.json`]: json({
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: Object.fromEntries(
          ["up", "down", "north", "south", "east", "west"].map((face) => [
            face,
            { texture: "block/test" },
          ]),
        ),
      },
    ],
  }),
  [`${base}textures/block/test.png`]: await encodePng(image),
};

test.each([
  ["blockstate", "blockstates/stone.json"],
  ["model", "models/block/stone.json"],
  ["parent", "models/block/base.json"],
  ["malformed", "models/block/base.json"],
])(
  "rejects %s payload damage despite a valid complete marker",
  async (failure, relative) => {
    const dir = path.join(root, failure);
    await installAssetFiles(dir, files, "a".repeat(40));
    const grid = new BlockGrid({ x: 1, y: 1, z: 1 }, "minecraft:stone");
    const renderer = new Renderer(dir);
    await renderer.hero(grid);
    expect(renderer.missingTextures).toEqual([]);
    const file = path.join(dir, base, relative);
    if (failure === "malformed") await Bun.write(file, "{");
    else await rm(file);
    expect(await assetCacheReady(dir)).toBe(true);
    const render = new Renderer(dir).hero(grid);
    if (failure === "malformed") await expect(render).rejects.toThrow();
    else await expect(render).rejects.toThrow(/ENOENT/u);
    expect(await Bun.file(path.join(dir, ".complete")).text()).toBe(
      `${"a".repeat(40)}\n`,
    );
  },
);

test("retains deliberate built-in entity models with no file-backed parent", async () => {
  const dir = path.join(root, "entity");
  await Bun.write(
    path.join(dir, base, "models/block/chest.json"),
    JSON.stringify({
      parent: "builtin/entity",
      textures: { particle: "block/test" },
    }),
  );
  expect(await new ModelResolver(dir).model("block/chest")).toEqual({
    elements: [],
    particle: "block/test",
  });
});
