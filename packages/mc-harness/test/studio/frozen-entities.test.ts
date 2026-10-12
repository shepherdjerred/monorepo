import { describe, expect, it } from "vitest";
import { validateFrozenExpected } from "#build/frozen-expected.ts";
import type { RegionReadResponse } from "#protocol/bridge.ts";
import fixtures from "#test/fixtures/entity-schematics.json";

// Gzipped Sponge v3 fixtures: one oak_sign block with NBT type minecraft:sign,
// then variants with duplicate, out-of-bounds and absent BlockEntities entries.
const bytes = (name: keyof typeof fixtures) =>
  Buffer.from(fixtures[name], "base64");
const box = {
  world: "world",
  min: { x: -3, y: 65, z: 8 },
  max: { x: -2, y: 65, z: 8 },
};
function region(): RegionReadResponse {
  const blocks = Buffer.alloc(8);
  return {
    ...box,
    size: { x: 2, y: 1, z: 1 },
    palette: ["minecraft:oak_sign[rotation=0,waterlogged=false]"],
    blocks: blocks.toString("base64"),
    blockEntities: [
      { pos: box.min, id: "minecraft:oak_sign" },
      { pos: box.max, id: "minecraft:oak_sign" },
    ],
  };
}
function parts(first: keyof typeof fixtures = "sign") {
  return [
    { at: box.min, bytes: bytes(first) },
    { at: box.max, bytes: bytes("sign") },
  ];
}

describe("frozen block-entity evidence", () => {
  it("matches holder ids across translated tiles and different NBT type names", async () => {
    const result = await validateFrozenExpected(box, region(), parts());
    expect(result.blockEntities).toEqual([
      { pos: { x: 0, y: 0, z: 0 }, id: "minecraft:oak_sign" },
      { pos: { x: 1, y: 0, z: 0 }, id: "minecraft:oak_sign" },
    ]);
  });
  it.each(["missing", "duplicate", "outside", "moved", "holder"])(
    "rejects %s region entity evidence even when every block matches",
    async (failure) => {
      const data = region();
      const entity = data.blockEntities[0];
      if (entity === undefined) throw new Error("missing fixture entity");
      switch (failure) {
        case "missing":
          data.blockEntities.shift();
          break;
        case "duplicate":
          data.blockEntities.push(entity);
          break;
        case "holder":
          entity.id = "minecraft:chest";
          break;
        default:
          entity.pos = { ...box.min, z: failure === "moved" ? 9 : 7 };
      }
      await expect(validateFrozenExpected(box, data, parts())).rejects.toThrow(
        /block.entit/u,
      );
    },
  );
  it.each(["duplicate", "outside", "empty"] as const)(
    "rejects %s frozen entity evidence even when every block matches",
    async (failure) => {
      await expect(
        validateFrozenExpected(box, region(), parts(failure)),
      ).rejects.toThrow(/block entit/u);
    },
  );
});
