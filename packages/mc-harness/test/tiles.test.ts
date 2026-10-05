import { describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import type { Box, RegionReadResponse } from "#protocol/bridge.ts";
import {
  boxVolume,
  cropGrid,
  joinSnapshotIds,
  mergeRegionReads,
  placeGrid,
  splitSnapshotIds,
  tileBox,
} from "#build/tiles.ts";

const big: Box = {
  world: "world",
  min: { x: -250, y: -64, z: -250 },
  max: { x: 249, y: -15, z: 249 },
};

/** A fake region read of `box` whose cell state encodes its world x and z. */
function readOf(box: Box): RegionReadResponse {
  const size = {
    x: box.max.x - box.min.x + 1,
    y: box.max.y - box.min.y + 1,
    z: box.max.z - box.min.z + 1,
  };
  const palette: string[] = [];
  const bytes = Buffer.alloc(size.x * size.y * size.z * 4);
  for (let y = 0; y < size.y; y += 1) {
    for (let z = 0; z < size.z; z += 1) {
      for (let x = 0; x < size.x; x += 1) {
        const state = `s${String((box.min.x + x) % 3)}-${String((box.min.z + z) % 2)}`;
        let index = palette.indexOf(state);
        if (index === -1) {
          index = palette.push(state) - 1;
        }
        bytes.writeUInt32LE(index, ((y * size.z + z) * size.x + x) * 4);
      }
    }
  }
  return {
    world: box.world,
    min: box.min,
    max: box.max,
    size,
    palette,
    blocks: bytes.toString("base64"),
    blockEntities: [{ pos: box.min, id: "minecraft:chest" }],
  };
}

function cell(
  read: RegionReadResponse,
  x: number,
  y: number,
  z: number,
): string | undefined {
  return read.palette[
    Buffer.from(read.blocks, "base64").readUInt32LE(
      ((y * read.size.z + z) * read.size.x + x) * 4,
    )
  ];
}

describe("tileBox", () => {
  it("returns a box within the limit unchanged", () => {
    const small: Box = { ...big, max: { x: -200, y: -15, z: -200 } };
    expect(tileBox(small)).toEqual([small]);
  });

  it("covers a 500×50×500 box exactly with full-height tiles under the limit", () => {
    const tiles = tileBox(big, 3_000_000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.reduce((sum, tile) => sum + boxVolume(tile), 0)).toBe(
      boxVolume(big),
    );
    for (const tile of tiles) {
      expect(boxVolume(tile)).toBeLessThanOrEqual(3_000_000);
      expect(tile.min.y).toBe(big.min.y);
      expect(tile.max.y).toBe(big.max.y);
    }
  });
});

describe("mergeRegionReads", () => {
  it("matches a direct read of the whole box", () => {
    const box: Box = {
      world: "world",
      min: { x: -5, y: 0, z: 3 },
      max: { x: 14, y: 3, z: 17 },
    };
    const merged = mergeRegionReads(
      box,
      tileBox(box, 120).map((tile) => readOf(tile)),
    );
    const direct = readOf(box);
    for (const [x, y, z] of [
      [0, 0, 0],
      [19, 3, 14],
      [7, 2, 9],
    ] as const) {
      expect(cell(merged, x, y, z)).toBe(cell(direct, x, y, z));
    }
    expect(merged.size).toEqual(direct.size);
    expect(merged.blockEntities.length).toBe(tileBox(box, 120).length);
  });

  it("refuses tiles that do not cover the box", () => {
    const box: Box = {
      world: "world",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 9, y: 1, z: 9 },
    };
    const [first] = tileBox(box, 50);
    expect(() => mergeRegionReads(box, [readOf(first ?? box)])).toThrow(
      /cover/u,
    );
  });
});

describe("grid tiles and composite snapshot ids", () => {
  it("crops and places grids round-trip", () => {
    const grid = new BlockGrid({ x: 6, y: 2, z: 5 });
    grid.set(4, 1, 3, "minecraft:stone");
    const tile = cropGrid(grid, { x: 3, y: 0, z: 2 }, { x: 3, y: 2, z: 3 });
    expect(tile.get(1, 1, 1)).toBe("minecraft:stone");
    const back = new BlockGrid(grid.size);
    placeGrid(back, tile, { x: 3, y: 0, z: 2 });
    expect(back.get(4, 1, 3)).toBe("minecraft:stone");
  });

  it("joins and splits tile snapshot ids", () => {
    expect(splitSnapshotIds(joinSnapshotIds(["a-1", "b-2"]))).toEqual([
      "a-1",
      "b-2",
    ]);
    expect(splitSnapshotIds("only-1")).toEqual(["only-1"]);
  });
});
