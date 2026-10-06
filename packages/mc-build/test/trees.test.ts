import { describe, expect, test } from "vitest";
import { createBuildContext } from "#src/dsl/context.ts";
import { tintFor } from "#src/render/tint.ts";
import { loadRegistry } from "#src/registry/registry.ts";

const registry = await loadRegistry();

function grow(
  spec: Parameters<
    ReturnType<typeof createBuildContext>["ctx"]["craft"]["tree"]
  >[0],
) {
  const { ctx, canvas } = createBuildContext({ registry, seed: 5, site: null });
  ctx.set(spec.x + 3, spec.y + 4, spec.z, "minecraft:stone");
  const result = ctx.craft.tree(spec);
  const { grid, min } = canvas.compile();
  const at = (x: number, y: number, z: number) =>
    grid.get(x - min.x, y - min.y, z - min.z);
  return { result, grid, min, at };
}

/** Grid-local y of the highest non-air cell. */
function highestBlock(grid: ReturnType<typeof grow>["grid"]): number {
  for (let y = grid.size.y - 1; y >= 0; y -= 1) {
    for (let index = 0; index < grid.size.x * grid.size.z; index += 1) {
      const x = index % grid.size.x;
      const z = Math.floor(index / grid.size.x);
      if (!grid.isAirAt(x, y, z)) {
        return y;
      }
    }
  }
  return -1;
}

describe("craft.tree", () => {
  test("grows a wood trunk and persistent mixed leaves, deterministically", () => {
    const a = grow({
      x: 0,
      y: 1,
      z: 0,
      species: "oak",
      size: "medium",
      seed: 4,
    });
    const b = grow({
      x: 0,
      y: 1,
      z: 0,
      species: "oak",
      size: "medium",
      seed: 4,
    });
    expect(a.at(0, 1, 0)).toBe("minecraft:oak_wood[axis=y]");
    expect([...a.grid.data]).toEqual([...b.grid.data]);
    const leaves = a.grid.palette.filter((state) => state.includes("_leaves"));
    expect(leaves.length).toBeGreaterThan(1);
    for (const state of leaves) {
      expect(state).toContain("persistent=true");
    }
    expect(a.result.top).toBeGreaterThan(1 + 7);
  });

  test("never overwrites blocks already placed", () => {
    const { at } = grow({
      x: 0,
      y: 1,
      z: 0,
      species: "oak",
      size: "large",
      seed: 2,
    });
    expect(at(3, 5, 0)).toBe("minecraft:stone");
    const { ctx, canvas } = createBuildContext({
      registry,
      seed: 5,
      site: null,
    });
    ctx.set(0, 3, 0, "minecraft:gold_block");
    ctx.craft.tree({
      x: 0,
      y: 1,
      z: 0,
      species: "oak",
      size: "small",
      seed: 1,
    });
    const { grid, min } = canvas.compile();
    expect(grid.get(0 - min.x, 3 - min.y, 0 - min.z)).toBe(
      "minecraft:gold_block",
    );
  });

  test("top clears every placed block, including high branch canopies", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { result, grid, min } = grow({
        x: 0,
        y: 1,
        z: 0,
        species: "oak",
        size: "large",
        seed,
      });
      expect(result.top).toBeGreaterThan(min.y + highestBlock(grid));
    }
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "a spruce closes its cone over the trunk (seed %i)",
    (seed) => {
      const { at } = grow({
        x: 0,
        y: 1,
        z: 0,
        species: "spruce",
        size: "medium",
        seed,
      });
      // trunk height 10 → leaves cap the column above the last wood block
      expect(at(0, 10, 0)).toMatch(/^minecraft:spruce_wood/u);
      expect(at(0, 11, 0)).toMatch(/^minecraft:spruce_leaves/u);
      expect(at(0, 12, 0)).toMatch(/^minecraft:spruce_leaves/u);
    },
  );

  test("rejects a trunk shorter than 3", () => {
    expect(() => grow({ x: 0, y: 1, z: 0, height: 2 })).toThrow(/height/u);
  });
});

describe("leaf tint", () => {
  test("cherry, azalea and pale oak leaves render untinted; oak stays foliage green", () => {
    expect(tintFor("minecraft:cherry_leaves")).toEqual([1, 1, 1]);
    expect(tintFor("minecraft:flowering_azalea_leaves")).toEqual([1, 1, 1]);
    expect(tintFor("minecraft:pale_oak_leaves")).toEqual([1, 1, 1]);
    expect(tintFor("minecraft:oak_leaves")).not.toEqual([1, 1, 1]);
  });
});
