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
  return { result, grid, at };
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
  });

  test("a spruce closes its cone over the trunk", () => {
    const { at } = grow({
      x: 0,
      y: 1,
      z: 0,
      species: "spruce",
      size: "medium",
      seed: 1,
    });
    // trunk height 10 → leaves cap the column above the last wood block
    expect(at(0, 10, 0)).toMatch(/^minecraft:spruce_wood/u);
    expect(at(0, 11, 0)).toMatch(/^minecraft:spruce_leaves/u);
    expect(at(0, 12, 0)).toMatch(/^minecraft:spruce_leaves/u);
  });

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
