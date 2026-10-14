import path from "node:path";
import type { BlockGrid, Vec3 } from "@shepherdjerred/mc-build/core/grid.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { describe, expect, test } from "vitest";
import { AuthoredMap } from "./author.ts";

const ids = [
  "catacombs",
  "sunspire",
  "railcut",
  "overgrown-relay",
  "stormbreak",
];

// A deliberately conservative dry route check. Paper/native navigation is the acceptance layer
// for fractional stairs, jumping, swimming and entity-sized clearance.
function stands(grid: BlockGrid, at: Vec3): boolean {
  if (
    !grid.inBounds(at.x, at.y - 1, at.z) ||
    !grid.inBounds(at.x, at.y + 1, at.z)
  )
    return false;
  const floor = grid.get(at.x, at.y - 1, at.z);
  return (
    grid.get(at.x, at.y, at.z) === "minecraft:air" &&
    grid.get(at.x, at.y + 1, at.z) === "minecraft:air" &&
    floor !== "minecraft:air" &&
    !/^minecraft:(?:water|rail|ladder|.*_wall|.*_fence|.*_leaves|.*lantern)(?:\[|$)/u.test(
      floor,
    )
  );
}

function neighbors(at: Vec3): Vec3[] {
  return [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].flatMap(([dx = 0, dz = 0]) =>
    [0, 1, -1, -2].map((dy) => ({ x: at.x + dx, y: at.y + dy, z: at.z + dz })),
  );
}

function dryReachable(grid: BlockGrid, start: Vec3): Uint8Array {
  const seen = new Uint8Array(grid.volume);
  const queue = [start];
  seen[grid.index(start.x, start.y, start.z)] = 1;
  for (const at of queue)
    for (const next of neighbors(at)) {
      if (!stands(grid, next)) continue;
      const index = grid.index(next.x, next.y, next.z);
      if (seen[index] !== 0) continue;
      seen[index] = 1;
      queue.push(next);
    }
  return seen;
}

describe("expansion map dry approaches", () => {
  for (const id of ids)
    test(`${id} connects both bombs and any nuke to a deployment court`, async () => {
      const map = AuthoredMap.parse(
        await Bun.file(
          path.join(import.meta.dir, "authored", `${id}.json`),
        ).json(),
      );
      const target = path.resolve(
        import.meta.dir,
        "../../server/owned/plugins/TheStorm/rwf/maps",
        id,
        "blocks.schem",
      );
      const { grid } = await readSchematic(
        new Uint8Array(await Bun.file(target).arrayBuffer()),
      );
      const start = { x: 5, y: 9, z: Math.floor(map.size.z / 2) - 6 };
      expect(stands(grid, start)).toBe(true);
      const seen = dryReachable(grid, start);
      for (const at of [...map.bombs, ...map.nukes]) {
        const approaches = neighbors(at).filter(
          (next) => next.y === at.y && stands(grid, next),
        );
        expect(approaches.length).toBeGreaterThanOrEqual(2);
        expect(
          approaches.some(
            (next) => seen[grid.index(next.x, next.y, next.z)] === 1,
          ),
        ).toBe(true);
      }
    });
});
