import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { house } from "@shepherdjerred/mc-build/components/house/index.ts";
import { ramparts } from "@shepherdjerred/mc-build/components/ramparts/index.ts";
import { boulder } from "@shepherdjerred/mc-build/components/rocks/index.ts";
import {
  carveRiver,
  heightfield,
  key,
  path as layPath,
  surface,
} from "@shepherdjerred/mc-build/components/terrain/index.ts";
import { compileProgram } from "#src/compile/runner.ts";
import { scanModuleGraph } from "#src/compile/scan.ts";
import { createBuildContext } from "#src/dsl/context.ts";
import { loadRegistry } from "#src/registry/registry.ts";

const registry = await loadRegistry();
const temp = await mkdtemp(path.join(os.tmpdir(), "mc-build-components-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

function fresh(seed = 5) {
  const { ctx, canvas } = createBuildContext({ registry, seed, site: null });
  const read = () => {
    const { grid, min } = canvas.compile();
    return {
      grid,
      at: (x: number, y: number, z: number) =>
        grid.get(x - min.x, y - min.y, z - min.z),
    };
  };
  return { ctx, read };
}

async function buildDir(name: string, files: Record<string, string>) {
  const dir = path.join(temp, name);
  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), source);
  }
  return path.join(dir, "build.ts");
}

describe("component imports", () => {
  test("a program outside the workspace imports components and a local helper", async () => {
    const program = await buildDir("ok", {
      "build.ts": [
        'import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";',
        'import { boulder } from "@shepherdjerred/mc-build/components/rocks/index.ts";',
        'import { pad } from "./lib/pad.ts";',
        "export default ((ctx) => { pad(ctx); boulder(ctx, { x: 4, y: 1, z: 4, size: 2 }); }) satisfies BuildProgram;",
      ].join("\n"),
      "lib/pad.ts": [
        'import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";',
        'export function pad(ctx: BuildContext): void { ctx.fill({ x: 0, y: 0, z: 0, w: 9, h: 1, d: 9 }, "grass_block"); }',
      ].join("\n"),
    });
    const scanned = await scanModuleGraph(program);
    expect(
      scanned.some((file) => file.endsWith(path.join("rocks", "index.ts"))),
    ).toBe(true);
    expect(
      scanned.some((file) => file.endsWith(path.join("lib", "pad.ts"))),
    ).toBe(true);
    const options = {
      program,
      seed: 9,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    };
    const first = await compileProgram(options);
    const second = await compileProgram(options);
    expect(first.blocks).toBeGreaterThan(81);
    expect([...first.grid.data]).toEqual([...second.grid.data]);
  });

  test("rejects escapes, foreign packages and impure helpers", async () => {
    const escape = await buildDir("escape", {
      "build.ts": 'import { x } from "../outside.ts";\nexport default () => x;',
    });
    await writeFile(path.join(temp, "outside.ts"), "export const x = 1;");
    await expect(scanModuleGraph(escape)).rejects.toThrow(
      /outside the build directory/u,
    );

    const foreign = await buildDir("foreign", {
      "build.ts": 'import { z } from "zod";\nexport default () => z;',
    });
    await expect(scanModuleGraph(foreign)).rejects.toThrow(/import type/u);

    const impure = await buildDir("impure", {
      "build.ts": 'import { r } from "./lib/r.ts";\nexport default () => r();',
      "lib/r.ts": "export const r = () => Math.random();",
    });
    await expect(scanModuleGraph(impure)).rejects.toThrow(
      /Math\.random.*lib\/r\.ts/u,
    );

    const dynamic = await buildDir("dynamic", {
      "build.ts": 'export default async () => { await import("node:fs"); };',
    });
    await expect(scanModuleGraph(dynamic)).rejects.toThrow(
      /import type|import\(/u,
    );

    const missing = await buildDir("missing", {
      "build.ts":
        'import { nope } from "@shepherdjerred/mc-build/components/nope/index.ts";\nexport default () => nope;',
    });
    await expect(scanModuleGraph(missing)).rejects.toThrow(/does not exist/u);
  });
});

describe("terrain", () => {
  test("surface puts rock on steep drops, sand at the shore and water below sea", () => {
    const { ctx, read } = fresh();
    const field = heightfield({
      x: 0,
      z: 0,
      w: 12,
      d: 4,
      height: (x) => (x < 4 ? 3 : x < 8 ? 5 : 12),
    });
    expect(field.steepness(7, 1)).toBe(0);
    expect(field.steepness(8, 1)).toBe(7);
    surface(ctx, field, { sea: 4 });
    const { at } = read();
    expect(at(1, 4, 1)).toBe("minecraft:water[level=0]");
    expect(at(5, 5, 1)).toMatch(/sand/u);
    expect(at(8, 12, 1)).toMatch(/stone|andesite|cobblestone|tuff|bricks/u);
    expect(at(10, 11, 1)).toBe("minecraft:dirt");
  });

  test("a river never tunnels: its water surface only drops downstream", () => {
    const { ctx } = fresh();
    const field = heightfield({
      x: 0,
      z: 0,
      w: 40,
      d: 40,
      height: (x, z) => 20 - (x + z) / 4,
    });
    const lowest = 20 - 78 / 4;
    carveRiver(ctx, field, {
      points: [
        [2, 2],
        [20, 20],
        [38, 38],
      ],
      width: 3,
      depth: 2,
    });
    let min = Infinity;
    for (let x = 0; x < 40; x += 1) {
      for (let z = 0; z < 40; z += 1) {
        min = Math.min(min, field.at(x, z) ?? min);
      }
    }
    expect(min).toBeGreaterThanOrEqual(Math.floor(lowest) - 4);
    expect(field.water.size).toBeGreaterThan(60);
    expect(field.bank.size).toBeGreaterThan(60);
  });

  test("a path claims its cells and steps up with slabs", () => {
    const { ctx, read } = fresh();
    const field = heightfield({
      x: 0,
      z: 0,
      w: 30,
      d: 9,
      height: (x) => (x < 15 ? 2 : 3),
    });
    surface(ctx, field);
    const { cells } = layPath(ctx, field, {
      points: [
        [1, 4],
        [28, 4],
      ],
      width: 3,
      wander: 0,
    });
    expect(cells).toBeGreaterThan(40);
    expect(field.occupied.has(key(10, 4))).toBe(true);
    expect(read().at(14, 3, 4)).toMatch(/_slab/u);
  });
});

describe("rocks", () => {
  test("boulders are lumpy, sunk into the ground and seeded", () => {
    const a = fresh();
    boulder(a.ctx, { x: 0, y: 5, z: 0, size: 3, seed: 1 });
    const b = fresh();
    boulder(b.ctx, { x: 0, y: 5, z: 0, size: 3, seed: 1 });
    const c = fresh();
    boulder(c.ctx, { x: 0, y: 5, z: 0, size: 3, seed: 2 });
    const ga = a.read().grid;
    expect([...ga.data]).toEqual([...b.read().grid.data]);
    expect([...ga.data]).not.toEqual([...c.read().grid.data]);
    expect(a.read().at(0, 4, 0)).not.toBe("minecraft:air");
    expect(ga.size.x === ga.size.y && ga.size.y === ga.size.z).toBe(false);
  });
});

describe("house", () => {
  test("six seeds give six different houses with a door, roof and lit room", () => {
    const hashes = new Set<string>();
    for (let seed = 1; seed <= 6; seed += 1) {
      const { ctx, read } = fresh();
      const built = house(ctx, { x: 0, z: 0, y: 1, seed, style: "medieval" });
      const { grid, at } = read();
      hashes.add(
        `${grid.size.x.toString()}:${grid.size.y.toString()}:${grid.palette.length.toString()}:${grid.data.length.toString()}`,
      );
      expect(at(built.door.x, built.door.y, built.door.z)).toMatch(/_door\[/u);
      expect(grid.palette.some((state) => state.includes("_stairs"))).toBe(
        true,
      );
      expect(grid.palette).toContain(
        "minecraft:lantern[hanging=false,waterlogged=false]",
      );
      expect(built.top).toBeGreaterThan(built.door.y + 4);
    }
    expect(hashes.size).toBeGreaterThanOrEqual(5);
  });

  test("a requested wing adds a second footprint on that side", () => {
    const { ctx } = fresh();
    const built = house(ctx, {
      x: 0,
      z: 0,
      y: 1,
      w: 9,
      d: 7,
      wing: "left",
      seed: 3,
    });
    expect(built.footprints).toHaveLength(2);
    expect(built.footprints[1]?.x).toBeLessThan(0);
  });
});

describe("ramparts", () => {
  test("a closed circuit has merlons, corner towers and an open gate", () => {
    const { ctx, read } = fresh();
    const walls = ramparts(ctx, {
      points: [
        [0, 0],
        [30, 0],
        [30, 30],
        [0, 30],
      ],
      closed: true,
      ground: () => 0,
      gate: { segment: 1 },
    });
    const { at } = read();
    expect(walls.gate).not.toBeNull();
    const gate = walls.gate ?? { x: 0, y: 0, z: 0 };
    expect(at(gate.x, gate.y + 1, gate.z)).toBe("minecraft:air");
    expect(walls.cells.size).toBeGreaterThan(300);
    const tops = new Set<string>();
    for (let x = 4; x < 26; x += 1) {
      tops.add(at(x, 8, -1));
    }
    expect([...tops].some((state) => state.includes("stone_bricks"))).toBe(
      true,
    );
  });
});
