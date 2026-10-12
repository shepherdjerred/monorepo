import path from "node:path";
import {
  BlockGrid,
  gridFromRegionRead,
} from "@shepherdjerred/mc-build/core/grid.ts";
import { RegionReadSchema } from "@shepherdjerred/mc-build/core/region-read.ts";
import { describe, expect, it } from "vitest";
import {
  gradeTower,
  HCYL_R4_RING,
  type TowerSpec,
  towerBox,
} from "#evals/grade/geometry.ts";
import { E1_SPEC, E6_SPEC } from "#evals/grade/tower.ts";

/** Builds the spec'd tower in a grid covering towerBox(spec). */
function perfectTower(spec: TowerSpec): BlockGrid {
  const box = towerBox(spec);
  const grid = new BlockGrid({
    x: box.max.x - box.min.x + 1,
    y: box.max.y - box.min.y + 1,
    z: box.max.z - box.min.z + 1,
  });
  const set = (x: number, y: number, z: number, state: string): void => {
    grid.set(x - box.min.x, y - box.min.y, z - box.min.z, state);
  };
  for (let x = box.min.x; x <= box.max.x; x += 1) {
    for (let z = box.min.z; z <= box.max.z; z += 1) {
      set(x, spec.baseY - 1, z, `${spec.ground}[snowy=false]`);
    }
  }
  const { x: cx, z: cz } = spec.center;
  for (let y = spec.baseY; y < spec.baseY + spec.height; y += 1) {
    for (const [dx, dz] of HCYL_R4_RING) {
      set(cx + dx, y, cz + dz, spec.wall);
    }
  }
  set(cx, spec.baseY, cz + 4, "minecraft:air");
  set(cx, spec.baseY + 1, cz + 4, "minecraft:air");
  set(cx, spec.baseY + 5, cz - 4, spec.window);
  set(cx, spec.baseY + 6, cz - 4, spec.window);
  // Alternate around the ring: keep cells whose (dx + dz) is even.
  for (const [dx, dz] of HCYL_R4_RING) {
    if ((dx + dz) % 2 === 0) {
      set(cx + dx, spec.baseY + spec.height, cz + dz, spec.wall);
    }
  }
  return grid;
}

const failing = (grid: BlockGrid, spec: TowerSpec): string[] =>
  gradeTower(grid, spec)
    .filter((check) => !check.pass)
    .map((check) => check.name);

describe("gradeTower", () => {
  it("passes a perfect E1 and E6 tower", () => {
    expect(failing(perfectTower(E1_SPEC), E1_SPEC)).toEqual([]);
    expect(failing(perfectTower(E6_SPEC), E6_SPEC)).toEqual([]);
  });

  it("passes the real Codex round-1 tower region", async () => {
    const raw: unknown = JSON.parse(
      await Bun.file(
        path.join(
          import.meta.dirname,
          "fixtures",
          "e1-codex-tower.region.json",
        ),
      ).text(),
    );
    const region = RegionReadSchema.parse(raw);
    // The fixture was read at center ±6, y -61..-44: exactly towerBox(E1_SPEC).
    expect(region.min).toEqual(towerBox(E1_SPEC).min);
    expect(failing(gridFromRegionRead(region), E1_SPEC)).toEqual([]);
  });

  it("names each broken requirement", () => {
    const spec = E1_SPEC;
    const box = towerBox(spec);
    const grid = perfectTower(spec);
    const set = (x: number, y: number, z: number, state: string): void => {
      grid.set(x - box.min.x, y - box.min.y, z - box.min.z, state);
    };
    set(4, -50, 0, "minecraft:air");
    set(0, -55, -4, "minecraft:stone_bricks");
    set(0, -50, 0, "minecraft:torch");
    set(0, -45, 0, "minecraft:stone");
    expect(failing(grid, spec)).toEqual([
      "wall ring",
      "no stray blocks in tower layers",
      "window glass",
      "nothing above the crenellations",
    ]);
  });

  it("rejects solid or unalternated crenellations", () => {
    const spec = E1_SPEC;
    const box = towerBox(spec);
    const grid = perfectTower(spec);
    for (const [dx, dz] of HCYL_R4_RING) {
      grid.set(
        dx - box.min.x,
        spec.baseY + spec.height - box.min.y,
        dz - box.min.z,
        spec.wall,
      );
    }
    expect(failing(grid, spec)).toEqual(["crenellations alternate"]);
  });
});
