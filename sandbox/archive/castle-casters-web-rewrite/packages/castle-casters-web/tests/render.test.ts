import { describe, expect, test } from "bun:test";
import { boardToMapPixels } from "#src/render/renderer.ts";
import { textureIdForTileset, tileUv } from "#src/render/tiled.ts";

describe("tile UV helpers", () => {
  test("maps Tiled global IDs to columns and rows", () => {
    expect(tileUv(1, 39)).toEqual({ column: 0, row: 0 });
    expect(tileUv(42, 39)).toEqual({ column: 2, row: 1 });
    expect(tileUv(2497, 39, 2497)).toEqual({ column: 0, row: 0 });
  });

  test("maps Tiled tileset image paths to manifest texture IDs", () => {
    expect(textureIdForTileset({ columns: 39, firstgid: 2497, image: "../tilesets/main/terrain.png", imageheight: 608, imagewidth: 624, name: "terrain", tilecount: 1482, tileheight: 16, tilewidth: 16 })).toBe("main/terrain");
  });
});

describe("Java map conversion", () => {
  test("maps board coordinates to Java map pixels", () => {
    expect(boardToMapPixels(0, 0)).toEqual({ x: 21 * 23, y: 30 * 23 });
    expect(boardToMapPixels(8, 16)).toEqual({ x: 29 * 23, y: 14 * 23 });
    expect(boardToMapPixels(16, 16)).toEqual({ x: 37 * 23, y: 14 * 23 });
  });
});
