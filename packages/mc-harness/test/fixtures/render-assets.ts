/** Authored unit assets; exercise real meshing, shading and PNG output without downloading a client. */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { encodePng } from "@shepherdjerred/mc-build/render/index.ts";
import { Image } from "@shepherdjerred/mc-build/render/raster.ts";

let pack: Promise<string> | undefined;
async function createPack(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mc-unit-assets-"));
  const write = async (file: string, value: unknown) =>
    Bun.write(path.join(root, "assets/minecraft", file), JSON.stringify(value));
  for (const [block, colour] of [
    ["stone", [150, 150, 150]],
    ["oak_planks", [150, 100, 50]],
    ["grass_block", [70, 150, 60]],
    ["dirt", [120, 80, 40]],
    ["lantern", [240, 180, 70]],
  ] as const) {
    const image = new Image(16, 16);
    for (let x = 0; x < 16; x += 1)
      for (let y = 0; y < 16; y += 1) {
        const shade = (x * 7 + y * 3) % 24;
        image.pixels.set(
          [colour[0] - shade, colour[1] - shade, colour[2] - shade, 255],
          (y * 16 + x) * 4,
        );
      }
    await Bun.write(
      path.join(root, `assets/minecraft/textures/block/${block}.png`),
      await encodePng(image),
    );
    await write(`blockstates/${block}.json`, {
      variants: { "": { model: `block/${block}` } },
    });
    await write(`models/block/${block}.json`, {
      textures: { particle: `block/${block}` },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: Object.fromEntries(
            ["down", "up", "north", "south", "west", "east"].map((face) => [
              face,
              { texture: `block/${block}`, cullface: face },
            ]),
          ),
        },
      ],
    });
  }
  // A complete model whose texture is deliberately absent exercises texture errors.
  await write("blockstates/nonexistent_texture_test.json", {
    variants: { "": { model: "block/missing_texture_test" } },
  });
  await write("models/block/missing_texture_test.json", {
    parent: "builtin/entity",
    textures: { particle: "block/nonexistent_texture_test" },
  });
  return root;
}
export function renderAssets(): Promise<string> {
  pack ??= createPack();
  return pack;
}
afterAll(async () => {
  if (pack !== undefined)
    await rm(await pack, { recursive: true, force: true });
});
