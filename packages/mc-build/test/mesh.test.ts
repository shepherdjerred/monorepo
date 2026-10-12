import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { importMesh } from "#src/import/mesh.ts";
import { parseMtl, parseObj } from "#src/import/obj.ts";
import {
  blockForTexture,
  nearestBlockMatcher,
  PALETTE_NAMES,
  type PaletteEntry,
  paletteTextures,
  toOklab,
} from "#src/import/palette.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import {
  closestBarycentric,
  triangleBoxOverlap,
} from "#src/import/voxelize.ts";

/** Self-authored test colors (not Mojang's). */
const TEST_PALETTE: PaletteEntry[] = [
  { block: "minecraft:white_concrete", rgb: { r: 0.95, g: 0.95, b: 0.95 } },
  { block: "minecraft:black_concrete", rgb: { r: 0.05, g: 0.05, b: 0.06 } },
  { block: "minecraft:red_concrete", rgb: { r: 0.6, g: 0.1, b: 0.1 } },
  { block: "minecraft:green_concrete", rgb: { r: 0.2, g: 0.45, b: 0.1 } },
  { block: "minecraft:blue_concrete", rgb: { r: 0.18, g: 0.2, b: 0.6 } },
  { block: "minecraft:yellow_concrete", rgb: { r: 0.95, g: 0.75, b: 0.1 } },
  { block: "minecraft:gray_concrete", rgb: { r: 0.4, g: 0.4, b: 0.42 } },
];

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mc-build-mesh-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CUBE = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 4 3 7 8
f 1 4 8 5
f 2 6 7 3
`;

function sphereObj(rings: number, segments: number): string {
  const lines: string[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const theta = (ring / rings) * Math.PI;
    for (let segment = 0; segment < segments; segment += 1) {
      const phi = (segment / segments) * 2 * Math.PI;
      lines.push(
        `v ${(Math.sin(theta) * Math.cos(phi)).toFixed(6)} ${Math.cos(theta).toFixed(6)} ${(Math.sin(theta) * Math.sin(phi)).toFixed(6)}`,
      );
    }
  }
  const id = (ring: number, segment: number): number =>
    ring * segments + (segment % segments) + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      lines.push(
        `f ${id(ring, segment).toString()} ${id(ring + 1, segment).toString()} ${id(ring + 1, segment + 1).toString()} ${id(ring, segment + 1).toString()}`,
      );
    }
  }
  return lines.join("\n");
}

async function write(name: string, text: string): Promise<string> {
  const file = path.join(dir, name);
  await Bun.write(file, text);
  return file;
}

function count(grid: {
  volume: number;
  data: Uint32Array;
  palette: string[];
}): number {
  return [...grid.data].filter(
    (index) => grid.palette[index] !== "minecraft:air",
  ).length;
}

describe("OBJ and MTL parsing", () => {
  test("fan-triangulates polygons and resolves negative indices", () => {
    const parsed = parseObj(
      "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n",
    );
    expect(parsed.faces).toHaveLength(1);
    expect(parsed.faces[0]?.corners.map((corner) => corner.v)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  test("rejects out-of-range indices loudly", () => {
    expect(() => parseObj("v 0 0 0\nf 1 2 3\n")).toThrow(/out of range/u);
  });

  test("reads Kd colors and the map_Kd file after options", () => {
    expect(
      parseMtl("newmtl red\nKd 1 0 0\nnewmtl tex\nmap_Kd -s 1 1 1 skin.png\n"),
    ).toEqual([
      { name: "red", color: { r: 1, g: 0, b: 0 }, texture: null },
      { name: "tex", color: { r: 0.7, g: 0.7, b: 0.7 }, texture: "skin.png" },
    ]);
  });
});

describe("voxel geometry", () => {
  test("triangle/box overlap separates on every axis family", () => {
    const tri = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
    ] as const;
    expect(
      triangleBoxOverlap(
        { center: { x: 0.5, y: 0.5, z: 0.4 }, half: 0.5 },
        tri,
      ),
    ).toBe(true);
    expect(
      triangleBoxOverlap(
        { center: { x: 0.5, y: 0.5, z: 0.6 }, half: 0.5 },
        tri,
      ),
    ).toBe(false); // plane
    expect(
      triangleBoxOverlap({ center: { x: 2, y: 2, z: 0 }, half: 0.5 }, tri),
    ).toBe(false); // edge axis
    expect(
      triangleBoxOverlap({ center: { x: -0.6, y: 0.5, z: 0 }, half: 0.5 }, tri),
    ).toBe(false); // box axis
  });

  test("closest barycentric clamps to edges and vertices", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 1, y: 0, z: 0 };
    const c = { x: 0, y: 1, z: 0 };
    expect(closestBarycentric({ x: -1, y: -1, z: 0 }, [a, b, c])).toEqual([
      1, 0, 0,
    ]);
    expect(closestBarycentric({ x: 0.5, y: -1, z: 3 }, [a, b, c])).toEqual([
      0.5, 0.5, 0,
    ]);
    const [wa, wb, wc] = closestBarycentric({ x: 0.25, y: 0.25, z: 5 }, [
      a,
      b,
      c,
    ]);
    expect(wa + wb + wc).toBeCloseTo(1);
    expect(wb).toBeCloseTo(0.25);
  });
});

describe("importMesh", () => {
  test("a cube becomes a hollow shell, or solid with --solid", async () => {
    const obj = await write("cube.obj", CUBE);
    const shell = await importMesh(obj, {
      height: 4,
      solid: false,
      palette: TEST_PALETTE,
    });
    expect(shell.grid.size).toEqual({ x: 4, y: 4, z: 4 });
    expect(count(shell.grid)).toBe(64 - 8);
    expect(shell.grid.get(1, 1, 1)).toBe("minecraft:air");
    const solid = await importMesh(obj, {
      height: 4,
      solid: true,
      palette: TEST_PALETTE,
    });
    expect(count(solid.grid)).toBe(64);
    expect(solid.interior).toBe(8);
  });

  test("a sphere is mirror-symmetric and fills inside", async () => {
    const obj = await write("sphere.obj", sphereObj(24, 48));
    const shell = await importMesh(obj, {
      height: 12,
      solid: false,
      palette: TEST_PALETTE,
    });
    const { x: sx, y: sy, z: sz } = shell.grid.size;
    expect(sy).toBe(12);
    for (let y = 0; y < sy; y += 1) {
      for (let z = 0; z < sz; z += 1) {
        for (let x = 0; x < sx; x += 1) {
          const here = shell.grid.get(x, y, z) === "minecraft:air";
          expect(shell.grid.get(sx - 1 - x, y, z) === "minecraft:air").toBe(
            here,
          );
          expect(shell.grid.get(x, y, sz - 1 - z) === "minecraft:air").toBe(
            here,
          );
        }
      }
    }
    expect(shell.grid.get(6, 6, 6)).toBe("minecraft:air");
    const solid = await importMesh(obj, {
      height: 12,
      solid: true,
      palette: TEST_PALETTE,
    });
    expect(solid.grid.get(6, 6, 6)).not.toBe("minecraft:air");
    expect(count(solid.grid)).toBeGreaterThan(count(shell.grid));
  });

  test("material colors and textures pick the nearest palette block", async () => {
    await write(
      "colors.mtl",
      "newmtl red\nKd 0.9 0.1 0.1\nnewmtl tex\nmap_Kd stripes.png\n",
    );
    // 2×1 texture: left half blue, right half yellow.
    await sharp(Buffer.from([40, 50, 160, 255, 240, 190, 30, 255]), {
      raw: { width: 2, height: 1, channels: 4 },
    })
      .png()
      .toFile(path.join(dir, "stripes.png"));
    const obj = await write(
      "colored.obj",
      [
        "mtllib colors.mtl",
        "v 0 0 0",
        "v 4 0 0",
        "v 4 4 0",
        "v 0 4 0",
        "v 6 0 0",
        "v 10 0 0",
        "v 10 4 0",
        "v 6 4 0",
        "vt 0.1 0.5",
        "vt 0.4 0.5",
        "vt 0.6 0.5",
        "vt 0.9 0.5",
        "usemtl red",
        "f 1 2 3 4",
        "usemtl tex",
        "f 5/1 6/2 7/2 8/1",
      ].join("\n"),
    );
    const result = await importMesh(obj, {
      height: 4,
      solid: false,
      palette: TEST_PALETTE,
    });
    const blocks = new Set(result.grid.palette);
    expect(blocks.has("minecraft:red_concrete")).toBe(true);
    expect(blocks.has("minecraft:blue_concrete")).toBe(true);
    expect(blocks.has("minecraft:yellow_concrete")).toBe(false);
  });

  test("fails loudly on an unknown material", async () => {
    const obj = await write(
      "missing.obj",
      "v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl nope\nf 1 2 3\n",
    );
    await expect(
      importMesh(obj, { height: 2, solid: false, palette: TEST_PALETTE }),
    ).rejects.toThrow(/no material library/u);
  });
});

describe("palettes", () => {
  test("maps colors to the perceptually nearest block", () => {
    const nearest = nearestBlockMatcher(TEST_PALETTE);
    expect(nearest({ r: 1, g: 1, b: 1 })).toBe("minecraft:white_concrete");
    expect(nearest({ r: 0, g: 0, b: 0 })).toBe("minecraft:black_concrete");
    expect(nearest({ r: 0.8, g: 0.05, b: 0.05 })).toBe(
      "minecraft:red_concrete",
    );
    expect(nearest({ r: 0.3, g: 0.6, b: 0.15 })).toBe(
      "minecraft:green_concrete",
    );
    expect(nearest({ r: 0.45, g: 0.45, b: 0.45 })).toBe(
      "minecraft:gray_concrete",
    );
  });

  test("OKLab puts white at L≈1 and black at 0", () => {
    expect(toOklab({ r: 1, g: 1, b: 1 }).l).toBeCloseTo(1, 3);
    expect(toOklab({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 6);
  });

  test("every curated palette block exists in the committed registry", async () => {
    const registry = await loadRegistry();
    for (const name of PALETTE_NAMES) {
      for (const texture of paletteTextures(name)) {
        expect(registry.has(blockForTexture(texture))).toBe(true);
      }
    }
    expect(registry.resolve(blockForTexture("deepslate"))).toBe(
      "minecraft:deepslate[axis=y]",
    );
  });

  test("palettes are curated full blocks without duplicates", () => {
    expect(paletteTextures("wool")).toHaveLength(16);
    expect(paletteTextures("terracotta")).toHaveLength(17);
    const all = paletteTextures("default");
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("quartz_block_side");
  });
});
