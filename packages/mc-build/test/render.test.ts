import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { viewProjector } from "#src/render/camera.ts";
import { encodePng, Renderer } from "#src/render/index.ts";

/**
 * Golden renders against a tiny texture pack authored in this test (our own
 * pixels and model JSON), so CI never needs Mojang assets.
 */
let root = "";

async function writeTexture(
  name: string,
  pixel: (x: number, y: number) => [number, number, number, number],
): Promise<void> {
  const data = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      data.set(pixel(x, y), (y * 16 + x) * 4);
    }
  }
  const file = path.join(
    root,
    "assets/minecraft/textures/block",
    `${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(
    file,
    await sharp(data, { raw: { width: 16, height: 16, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

async function writeJson(relative: string, value: unknown): Promise<void> {
  const file = path.join(root, "assets/minecraft", relative);
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, JSON.stringify(value));
}

const cube = (texture: string) => ({
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(
        ["down", "up", "north", "south", "west", "east"].map((face) => [
          face,
          { texture, cullface: face },
        ]),
      ),
    },
  ],
});

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mc-build-pack-"));
  await writeTexture("test_checker", (x, y) =>
    ((x >> 2) + (y >> 2)) % 2 === 0 ? [200, 40, 40, 255] : [240, 240, 240, 255],
  );
  await writeTexture("test_wood", (x, y) => [
    120 + ((x * 7 + y) % 20),
    80,
    40,
    255,
  ]);
  await writeTexture("test_window", (x, y) =>
    x === 0 || y === 0 || x === 15 || y === 15
      ? [60, 60, 70, 255]
      : [0, 0, 0, 0],
  );
  await writeTexture("test_grass", () => [180, 180, 180, 255]);
  await writeJson("models/block/test_parent.json", {
    textures: { particle: "#all" },
    ...cube("#all"),
  });
  await writeJson("models/block/test_checker.json", {
    parent: "minecraft:block/test_parent",
    textures: { all: "minecraft:block/test_checker" },
  });
  await writeJson("models/block/test_window.json", {
    parent: "block/test_parent",
    textures: { all: { sprite: "block/test_window" } },
  });
  await writeJson("models/block/test_grass.json", {
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          up: { texture: "#t", tintindex: 0, cullface: "up" },
          north: { texture: "#t" },
          south: { texture: "#t" },
          east: { texture: "#t" },
          west: { texture: "#t" },
          down: { texture: "#t" },
        },
      },
    ],
    textures: { t: "block/test_grass" },
  });
  await writeJson("models/block/test_step.json", {
    textures: { w: "block/test_wood" },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          up: { texture: "#w" },
          down: { texture: "#w" },
          north: { texture: "#w" },
          south: { texture: "#w" },
          east: { texture: "#w" },
          west: { texture: "#w" },
        },
      },
      {
        from: [8, 8, 0],
        to: [16, 16, 16],
        faces: {
          up: { texture: "#w" },
          north: { texture: "#w" },
          south: { texture: "#w" },
          east: { texture: "#w" },
          west: { texture: "#w" },
        },
      },
    ],
  });
  await writeJson("models/block/test_flat.json", {
    parent: "block/test_parent",
    textures: { all: "block/test_grass" },
  });
  await writeJson("blockstates/smooth_stone.json", {
    variants: { "": { model: "block/test_flat" } },
  });
  await writeJson("blockstates/stone.json", {
    variants: { "": { model: "minecraft:block/test_checker" } },
  });
  await writeJson("blockstates/glass.json", {
    variants: { "": { model: "block/test_window" } },
  });
  await writeJson("blockstates/grass_block.json", {
    variants: { "snowy=false": { model: "block/test_grass" } },
  });
  await writeJson("blockstates/oak_stairs.json", {
    variants: {
      "facing=east": { model: "block/test_step" },
      "facing=north": { model: "block/test_step", y: 270 },
    },
  });
  await writeJson("blockstates/chest.json", {
    variants: { "": { model: "block/test_chest" } },
  });
  await writeJson("models/block/test_chest.json", {
    textures: { particle: "block/test_wood" },
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function scene(): BlockGrid {
  const grid = new BlockGrid({ x: 4, y: 3, z: 4 });
  for (let x = 0; x < 4; x += 1) {
    for (let z = 0; z < 4; z += 1) {
      grid.set(
        x,
        0,
        z,
        (x + z) % 3 === 0
          ? "minecraft:grass_block[snowy=false]"
          : "minecraft:stone",
      );
    }
  }
  grid.set(
    1,
    1,
    1,
    "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]",
  );
  grid.set(
    2,
    1,
    1,
    "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
  );
  grid.set(1, 1, 2, "minecraft:glass");
  grid.set(
    2,
    1,
    2,
    "minecraft:chest[facing=north,type=single,waterlogged=false]",
  );
  grid.set(3, 2, 3, "minecraft:stone");
  grid.set(3, 1, 3, "minecraft:stone");
  return grid;
}

function pixelHash(pixels: Uint8Array): string {
  return createHash("sha256").update(pixels).digest("hex");
}

describe("renderer", () => {
  test("projects with front facing south and the top looking down", () => {
    const front = viewProjector("front");
    expect(front([1, 0, 0]).x).toBeGreaterThan(front([0, 0, 0]).x);
    expect(front([0, 1, 0]).y).toBeLessThan(front([0, 0, 0]).y);
    expect(front([0, 0, 1]).depth).toBeLessThan(front([0, 0, 0]).depth);
    const top = viewProjector("top");
    expect(top([0, 0, 1]).y).toBeGreaterThan(top([0, 0, 0]).y);
    expect(top([0, 1, 0]).depth).toBeLessThan(top([0, 0, 0]).depth);
  });

  test("renders deterministically and matches the golden hashes", async () => {
    const renderer = new Renderer(root);
    const iso = await renderer.view(scene(), "iso-front-right", 160);
    const again = await new Renderer(root).view(
      scene(),
      "iso-front-right",
      160,
    );
    expect(pixelHash(iso.pixels)).toBe(pixelHash(again.pixels));
    const sheet = await renderer.sheet(scene(), { title: "GOLDEN", tile: 120 });
    expect(renderer.missingTextures).toEqual([]);
    expect({
      iso: pixelHash(iso.pixels),
      sheet: pixelHash(sheet.pixels),
    }).toMatchInlineSnapshot(`
      {
        "iso": "6fab03b4cc2e18a0d8cf4eebfd1ac4aa3d9fda37a98c0d52ac9ce1c488b38a30",
        "sheet": "26a5bcff5177bea9a60872dd6302f4f58883b21de3e6eb638dd331caec1f2722",
      }
    `);
    const png = await encodePng(sheet);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  test("shades tops brighter than sides and tints grass", async () => {
    const flat = new BlockGrid({ x: 1, y: 1, z: 1 }, "minecraft:smooth_stone");
    const renderer = new Renderer(root);
    const center = (16 * 32 + 16) * 4;
    const top = await renderer.view(flat, "top", 32);
    const front = await renderer.view(flat, "front", 32);
    // Same uniform texture: top faces are full brightness, north/south 0.8.
    expect(top.pixels[center]).toBe(180);
    expect(front.pixels[center]).toBe(144);
    const grass = await renderer.view(
      new BlockGrid({ x: 1, y: 1, z: 1 }, "minecraft:grass_block[snowy=false]"),
      "top",
      32,
    );
    // Tinted green: green channel dominates the grey texture.
    expect(grass.pixels[center + 1] ?? 0).toBeGreaterThan(
      grass.pixels[center] ?? 0,
    );
  });
});
