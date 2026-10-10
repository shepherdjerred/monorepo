import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BlockGrid } from "#src/core/grid.ts";
import { perspectiveProjector, viewProjector } from "#src/render/camera.ts";
import { changedColumns } from "#src/render/compare.ts";
import { cropGrid, cropQuads, cutGrid, namedCrop } from "#src/render/cut.ts";
import { encodeJpeg, encodePng, Renderer } from "#src/render/index.ts";

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

  test("perspective puts the target at the frame centre and clips behind the eye", () => {
    const project = perspectiveProjector({
      eye: [5, 2, 20],
      target: [5, 2, 5],
      frame: { width: 200, height: 100 },
    });
    const centre = project([5, 2, 5]);
    expect(centre.x).toBeCloseTo(100);
    expect(centre.y).toBeCloseTo(50);
    expect(centre.clip).toBe(false);
    // Nearer points spread further from the centre than far ones.
    expect(Math.abs(project([7, 2, 15]).x - 100)).toBeGreaterThan(
      Math.abs(project([7, 2, 5]).x - 100),
    );
    expect(project([5, 2, 25]).clip).toBe(true);
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
    const value = await renderer.view(scene(), "iso-front-right", 160, {
      mode: "value",
    });
    const normal = await renderer.view(scene(), "iso-front-right", 160, {
      mode: "normal",
    });
    expect(renderer.missingTextures).toEqual([]);
    expect({
      iso: pixelHash(iso.pixels),
      sheet: pixelHash(sheet.pixels),
      isoValue: pixelHash(value.pixels),
      isoNormal: pixelHash(normal.pixels),
    }).toMatchInlineSnapshot(`
      {
        "iso": "6fab03b4cc2e18a0d8cf4eebfd1ac4aa3d9fda37a98c0d52ac9ce1c488b38a30",
        "isoNormal": "2b05f00265818f79b4fc3e1d4dcb3aacba08098e62817d9f91a23898be3eef6b",
        "isoValue": "b9549d2b673e00d1155d0aa7c11804c5ac8efe5144e9da664f4300a2edf6feac",
        "sheet": "26a5bcff5177bea9a60872dd6302f4f58883b21de3e6eb638dd331caec1f2722",
      }
    `);
    // Value mode is gray everywhere; normal mode is not textured.
    const centre = (80 * 160 + 80) * 4;
    expect(value.pixels[centre]).toBe(value.pixels[centre + 1]);
    expect(value.pixels[centre]).toBe(value.pixels[centre + 2]);
    const micro = await renderer.judgeSheet(scene(), {
      kind: "micro",
      label: "A",
      tile: 120,
    });
    const map = await renderer.judgeSheet(scene(), {
      kind: "map",
      label: "B",
      tile: 120,
    });
    expect({
      judgeMicro: pixelHash(micro.pixels),
      judgeMap: pixelHash(map.pixels),
    }).toMatchInlineSnapshot(`
      {
        "judgeMap": "5888ab2781ca8a45c6f92a5b66834f71cf20d2c02e9ee002598187566dee6846",
        "judgeMicro": "dce453d357a248f553c488ed6b4aa8e83d3cffa0c38890b15408b6a48b2202fe",
      }
    `);
    // Every other look the critique loop can ask for, each pinned.
    const looks: Record<string, string> = {};
    for (const mode of ["squint", "relief", "light"] as const) {
      const image = await renderer.view(scene(), "iso-front-right", 160, {
        mode,
      });
      looks[mode] = pixelHash(image.pixels);
    }
    const frontGrid = await renderer.view(scene(), "front", 160, { grid: 2 });
    looks["frontGrid"] = pixelHash(frontGrid.pixels);
    const elevations = await renderer.elevations(scene(), {
      tile: 96,
      grid: 2,
    });
    looks["elevations"] = pixelHash(elevations.pixels);
    const pov = await renderer.pov(scene(), { size: 160 });
    looks["pov"] = pixelHash(pov.pixels);
    const floor = cutGrid(scene(), { belowY: 1 });
    const floorLight = await renderer.view(floor, "top", 160, {
      mode: "light",
      lightFrom: scene(),
    });
    looks["floorLight"] = pixelHash(floorLight.pixels);
    const changed = scene();
    changed.set(0, 2, 0, "minecraft:stone");
    const compare = await renderer.compare(scene(), changed, { tile: 96 });
    looks["compare"] = pixelHash(compare.pixels);
    expect(looks).toMatchInlineSnapshot(`
      {
        "compare": "06bf50be9f5010c0b2a17072a395237832f8a6247cfe1a410434b1e7ea74c84d",
        "elevations": "c0f891b52051ca40ae90b9891b4a91f26d13e32cd60b8855450eae4f69cdd692",
        "floorLight": "be5ddf70e95a211a4f72dff5171a7055630ee41adaccca5128b233cf922e955d",
        "frontGrid": "56c282eca91516261b49a4529294e0ef5c6733f974ec41287ff102563ebdb8f1",
        "light": "b3e38aa34f3d50ae7c924e589a782fba9d8e9cad43b6f407190ddf6ba1503a7d",
        "pov": "7f384178258124426d26b81efe7f57e76c0f1b388995b7261f1d7ee0988e1a4a",
        "relief": "49a0d0e2850c533f15df72f989993c3858c56f4eaeecf2e002a097ecfb670259",
        "squint": "97bfb2635a9a0d5a0b2852ff93931c64e09a993ef1bd51542cebae5a23040fc8",
      }
    `);
    // The compare marks exactly the changed column.
    expect([...changedColumns(scene(), changed)]).toEqual(["0,0"]);
    // Cuts keep the grid size and drop what is outside the cut.
    expect(floor.size).toEqual(scene().size);
    expect(floor.isAirAt(3, 2, 3)).toBe(true);
    expect(namedCrop(scene(), "front-door").min.z).toBe(scene().size.z - 12);
    // A judge sheet at the default tile fits vision-model input without resizing.
    const full = await renderer.judgeSheet(scene(), {
      kind: "map",
      label: "C",
    });
    expect(full.width).toBeLessThanOrEqual(2000);
    expect(full.height).toBeLessThanOrEqual(2000);
    const jpeg = await encodeJpeg(full);
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
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

  test("modes reach elevations, pov and survey, and the default stays textured", async () => {
    const renderer = new Renderer(root);
    const grid = scene();
    const plain = await renderer.elevations(grid, { tile: 60 });
    const value = await renderer.elevations(grid, { tile: 60, mode: "value" });
    const normal = await renderer.elevations(grid, {
      tile: 60,
      mode: "normal",
    });
    expect(pixelHash(value.pixels)).not.toBe(pixelHash(plain.pixels));
    expect(pixelHash(normal.pixels)).not.toBe(pixelHash(plain.pixels));
    const pov = await renderer.pov(grid, { size: 120 });
    const povValue = await renderer.pov(grid, { size: 120, mode: "value" });
    const povNormal = await renderer.pov(grid, { size: 120, mode: "normal" });
    expect(pixelHash(povValue.pixels)).not.toBe(pixelHash(pov.pixels));
    expect(pixelHash(povNormal.pixels)).not.toBe(pixelHash(pov.pixels));
    const survey = await renderer.survey(grid, { blocksPerTile: 8, tile: 60 });
    const surveyValue = await renderer.survey(grid, {
      blocksPerTile: 8,
      tile: 60,
      mode: "value",
    });
    const first = survey.tiles[0];
    const firstValue = surveyValue.tiles[0];
    expect(first !== undefined && firstValue !== undefined).toBe(true);
    if (first !== undefined && firstValue !== undefined) {
      expect(pixelHash(firstValue.image.pixels)).not.toBe(
        pixelHash(first.image.pixels),
      );
    }
  });
});

describe("POV framing", () => {
  test("invisible light blocks preserve daylight at every emitted level", async () => {
    const renderer = new Renderer(root);
    const grid = new BlockGrid({ x: 5, y: 4, z: 5 });
    for (let x = 0; x < 5; x += 1)
      for (let z = 0; z < 5; z += 1) grid.set(x, 0, z, "minecraft:stone");
    const air = await renderer.view(grid, "iso-front-right", 160, {
      mode: "light",
    });
    for (let level = 0; level <= 15; level += 1) {
      grid.set(2, 2, 2, `minecraft:light[level=${level.toString()}]`);
      const lit = await renderer.view(grid, "iso-front-right", 160, {
        mode: "light",
      });
      expect(pixelHash(lit.pixels), `level ${level.toString()}`).toBe(
        pixelHash(air.pixels),
      );
    }
  });
  test("light views distinguish invisible light levels without drawing the source", async () => {
    const renderer = new Renderer(root);
    const hashes: string[] = [];
    for (const state of [
      "minecraft:air",
      "minecraft:light[level=0]",
      "minecraft:light[level=7]",
      "minecraft:light[level=15]",
    ]) {
      const whole = new BlockGrid({ x: 7, y: 6, z: 7 }, "minecraft:stone");
      for (let x = 1; x < 6; x += 1)
        for (let y = 1; y < 5; y += 1)
          for (let z = 1; z < 6; z += 1) whole.set(x, y, z, "minecraft:air");
      whole.set(3, 2, 3, state);
      const image = await renderer.view(
        cutGrid(whole, { belowY: 3, behindZ: 3 }),
        "iso-front-right",
        160,
        { mode: "light", lightFrom: whole },
      );
      hashes.push(pixelHash(image.pixels));
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(new Set(hashes.slice(1)).size).toBe(3);
  });
  test.each(["textured", "light", "relief"] as const)(
    "ignores empty capture headroom in %s mode",
    async (mode) => {
      const renderer = new Renderer(root);
      const compact = scene();
      const padded = new BlockGrid({ ...compact.size, y: 128 });
      compact.forEach((x, y, z, state) => padded.set(x, y, z, state));
      const original = await renderer.pov(compact, { size: 160, mode });
      const headroom = await renderer.pov(padded, { size: 160, mode });
      expect(pixelHash(headroom.pixels)).toBe(pixelHash(original.pixels));
      const skyOnly = new Uint8Array(original.pixels.length);
      for (let index = 0; index < skyOnly.length; index += 4)
        skyOnly.set([196, 214, 236, 255], index);
      expect(pixelHash(original.pixels)).not.toBe(pixelHash(skyOnly));
    },
  );
});

describe("survey", () => {
  test("comparison panels share occupied height and ignore empty capture headroom", async () => {
    const renderer = new Renderer(root);
    const before = new BlockGrid({ x: 8, y: 6, z: 8 });
    const after = new BlockGrid(before.size);
    const paddedBefore = new BlockGrid({ ...before.size, y: 128 });
    const paddedAfter = new BlockGrid(paddedBefore.size);
    for (let x = 0; x < 8; x += 1)
      for (let z = 0; z < 8; z += 1) {
        before.set(x, 0, z, "minecraft:stone");
        after.set(x, 0, z, "minecraft:stone");
      }
    for (let y = 1; y < 6; y += 1) after.set(4, y, 4, "minecraft:stone");
    before.forEach((x, y, z, state) => paddedBefore.set(x, y, z, state));
    after.forEach((x, y, z, state) => paddedAfter.set(x, y, z, state));
    const compact = await renderer.compare(before, after, { tile: 96 });
    const padded = await renderer.compare(paddedBefore, paddedAfter, {
      tile: 96,
    });
    expect(pixelHash(padded.pixels)).toBe(pixelHash(compact.pixels));
  });

  test.each([
    "textured",
    "value",
    "normal",
    "squint",
    "relief",
    "light",
  ] as const)(
    "close-up %s geometry retains whole-grid faces and shading",
    async (mode) => {
      const renderer = new Renderer(root);
      const grid = new BlockGrid({ x: 16, y: 12, z: 8 });
      for (let x = 0; x < 16; x += 1)
        for (let z = 0; z < 8; z += 1) grid.set(x, 0, z, "minecraft:stone");
      for (let y = 1; y <= 10; y += 1)
        for (let z = 0; z < 8; z += 1) grid.set(7, y, z, "minecraft:stone");
      const box = { min: { x: 8, y: 0, z: 0 }, max: { x: 15, y: 11, z: 7 } };
      const cropped = cropGrid(grid, box);
      const whole = await renderer.quadsFor(grid, mode);
      const actual = await renderer.quadsFor(cropped, mode, {
        cropFrom: { grid, box },
        lightFrom: grid,
        lightOrigin: box.min,
      });
      const remeshed = await renderer.quadsFor(cropped, mode, {
        lightFrom: grid,
        lightOrigin: box.min,
      });
      expect(actual.quads).toEqual(cropQuads(whole.quads, box));
      expect(actual.viewMode).toBe(whole.viewMode);
      expect(actual.quads).not.toEqual(remeshed.quads);
    },
  );

  test("tiles are shaded by the whole grid, not in isolation", async () => {
    const renderer = new Renderer(root);
    // A stone floor with a tall wall along the east edge of the first tile:
    // the relief sun (north-west) throws its shadow east, into the second tile.
    const grid = new BlockGrid({ x: 16, y: 12, z: 8 });
    for (let x = 0; x < 16; x += 1) {
      for (let z = 0; z < 8; z += 1) {
        grid.set(x, 0, z, "minecraft:stone");
      }
    }
    for (let y = 1; y <= 10; y += 1) {
      for (let z = 0; z < 8; z += 1) {
        grid.set(7, y, z, "minecraft:stone");
      }
    }
    const east = { min: { x: 8, y: 0, z: 0 }, max: { x: 15, y: 11, z: 7 } };
    const whole = await renderer.survey(grid, {
      blocksPerTile: 8,
      tile: 60,
      mode: "relief",
    });
    const alone = await renderer.survey(cropGrid(grid, east), {
      blocksPerTile: 8,
      tile: 60,
      mode: "relief",
    });
    expect(whole.tiles.map((tile) => tile.name)).toEqual(["A1", "A2"]);
    const shadowed = whole.tiles[1];
    const unshadowed = alone.tiles[0];
    expect(shadowed !== undefined && unshadowed !== undefined).toBe(true);
    if (shadowed !== undefined && unshadowed !== undefined) {
      expect(pixelHash(shadowed.image.pixels)).not.toBe(
        pixelHash(unshadowed.image.pixels),
      );
    }
  });
});

/** A `side`×`side` stone floor, two blocks tall so a block can sit on it. */
function stonePlane(side: number): BlockGrid {
  const grid = new BlockGrid({ x: side, y: 2, z: side });
  for (let x = 0; x < side; x += 1) {
    for (let z = 0; z < side; z += 1) {
      grid.set(x, 0, z, "minecraft:stone");
    }
  }
  return grid;
}

describe("skylight", () => {
  test("every air variant lets the sky through", async () => {
    const renderer = new Renderer(root);
    const open = new BlockGrid({ x: 3, y: 4, z: 3 });
    const caved = new BlockGrid({ x: 3, y: 4, z: 3 });
    for (const grid of [open, caved]) {
      for (let x = 0; x < 3; x += 1) {
        for (let z = 0; z < 3; z += 1) grid.set(x, 0, z, "minecraft:stone");
      }
    }
    caved.set(1, 3, 1, "minecraft:cave_air");
    const lit = await renderer.view(open, "top", 32, { mode: "light" });
    const cave = await renderer.view(caved, "top", 32, { mode: "light" });
    expect(pixelHash(cave.pixels)).toBe(pixelHash(lit.pixels));
  });
});

describe("section cut", () => {
  test("keeps the back half so the front views look into the interior", () => {
    const grid = new BlockGrid({ x: 3, y: 1, z: 6 });
    for (let z = 0; z < 6; z += 1) grid.set(1, 0, z, "minecraft:stone");
    const cut = cutGrid(grid, { behindZ: 2 });
    expect([0, 1, 2].map((z) => cut.isAirAt(1, 0, z))).toEqual([
      false,
      false,
      false,
    ]);
    expect([3, 4, 5].map((z) => cut.isAirAt(1, 0, z))).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("survey light", () => {
  test.each(["dark", "lamp", "opening"] as const)(
    "samples cropped light from the whole %s room",
    async (kind) => {
      const whole = new BlockGrid({ x: 21, y: 5, z: 21 }, "minecraft:stone");
      for (let x = 1; x < 20; x += 1)
        for (let y = 2; y < 4; y += 1)
          for (let z = 1; z < 20; z += 1) whole.set(x, y, z, "minecraft:air");
      if (kind === "lamp") whole.set(4, 2, 10, "minecraft:lantern");
      if (kind === "opening") whole.set(4, 4, 10, "minecraft:air");
      const renderer = new Renderer(root);
      const local = new BlockGrid({ x: 1, y: 1, z: 1 }, "minecraft:stone");
      const ordinary = await renderer.quadsFor(local);
      const lit = await renderer.quadsFor(local, "light", {
        lightFrom: whole,
        lightOrigin: { x: 5, y: 1, z: 10 },
      });
      const top = ordinary.quads.find(({ normal }) => normal?.[1] === 1);
      const litTop = lit.quads.find(({ normal }) => normal?.[1] === 1);
      if (top === undefined || litTop === undefined)
        throw new Error("missing top face");
      const factors = kind === "dark" ? [0.9, 0.25, 0.25] : [0.95, 0.95, 0.95];
      top.color.forEach((channel, index) =>
        expect(litTop.color[index]).toBeCloseTo(
          channel * (factors[index] ?? 0),
        ),
      );
    },
  );

  test("a cut survey is lit by the whole build when asked", async () => {
    const renderer = new Renderer(root);
    // A roofed stone room: cut below the roof, its floor is dark only when
    // the roof it lost still counts.
    const whole = new BlockGrid({ x: 8, y: 5, z: 8 });
    for (let x = 0; x < 8; x += 1) {
      for (let z = 0; z < 8; z += 1) {
        whole.set(x, 0, z, "minecraft:stone");
        whole.set(x, 4, z, "minecraft:stone");
      }
    }
    const cut = cutGrid(whole, { belowY: 2 });
    const alone = await renderer.survey(cut, {
      blocksPerTile: 8,
      tile: 60,
      mode: "light",
    });
    const lit = await renderer.survey(cut, {
      blocksPerTile: 8,
      tile: 60,
      mode: "light",
      lightFrom: whole,
    });
    const a = alone.tiles[0];
    const b = lit.tiles[0];
    expect(a !== undefined && b !== undefined).toBe(true);
    if (a !== undefined && b !== undefined) {
      expect(pixelHash(a.image.pixels)).not.toBe(pixelHash(b.image.pixels));
    }
  });
});

describe("large grids", () => {
  test("compare marks a changed corner of a map wider than its tile", async () => {
    const renderer = new Renderer(root);
    // 600 blocks across: the plan is drawn oversampled and shrunk, and the
    // marker for the far corner has to land inside it.
    const before = stonePlane(600);
    const after = stonePlane(600);
    after.set(599, 1, 599, "minecraft:oak_planks");
    const tile = 120;
    const sheet = await renderer.compare(before, after, { tile });
    let marked = 0;
    for (let y = tile / 2; y < tile; y += 1) {
      for (let x = 2 * tile + tile / 2; x < 3 * tile; x += 1) {
        const index = (y * sheet.width + x) * 4;
        const [r = 0, g = 0, b = 0] = sheet.pixels.subarray(index, index + 3);
        if (r > 150 && r > g + 60 && r > b + 60) marked += 1;
      }
    }
    expect(marked).toBeGreaterThan(0);
  }, 120_000);

  test("a view keeps the whole grid in frame instead of clipping its corners", async () => {
    const renderer = new Renderer(root);
    // A 300-block plane projects to ~424 px isometrically: wider than the tile.
    const grid = stonePlane(300);
    const size = 160;
    const iso = await renderer.view(grid, "iso-front-right", size);
    expect([iso.width, iso.height]).toEqual([size, size]);
    const background = [222, 228, 236];
    const at = (x: number, y: number): number[] => {
      const index = (y * size + x) * 4;
      return [...iso.pixels.subarray(index, index + 3)];
    };
    // The margin stays clear at every corner and the plane fills the middle.
    for (const [x, y] of [
      [2, 2],
      [size - 3, 2],
      [2, size - 3],
      [size - 3, size - 3],
    ] as const) {
      expect(at(x, y)).toEqual(background);
    }
    expect(at(size / 2, size / 2)).not.toEqual(background);
    const sheet = await renderer.judgeSheet(grid, {
      kind: "map",
      label: "B",
      tile: 120,
    });
    expect(sheet.width).toBeGreaterThan(0);
  }, 60_000);
});
