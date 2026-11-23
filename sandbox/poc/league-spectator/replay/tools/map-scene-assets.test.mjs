import { expect, test } from "bun:test";
import {
  readMapHeightGrid,
  mapBinHash,
  normalizeMapBin,
} from "./map-scene-assets.mjs";

function grid() {
  const offset = 39 + 54 + 1056;
  const bytes = new Uint8Array(offset + 16 + 16);
  const view = new DataView(bytes.buffer);
  bytes[0] = 7;
  view.setUint16(1, 1, true);
  for (const at of [15, 19, 23]) view.setFloat32(at, 100, true);
  view.setUint32(31, 1, true);
  view.setUint32(35, 1, true);
  view.setUint32(offset, 2, true);
  view.setUint32(offset + 4, 2, true);
  view.setFloat32(offset + 8, 50, true);
  view.setFloat32(offset + 12, 50, true);
  for (let index = 0; index < 4; index++)
    view.setFloat32(offset + 16 + index * 4, index, true);
  return bytes;
}
test("extracts an owned finite height grid from the admitted static format", () => {
  const bytes = grid(),
    result = readMapHeightGrid(bytes);
  expect(result).toMatchObject({
    min: [0, 0, 0],
    max: [100, 100, 100],
    movementOrigin: [50, 50],
    x: 2,
    z: 2,
    step: [50, 50],
  });
  bytes.fill(255);
  expect(new DataView(result.heights.buffer).getFloat32(12, true)).toBe(3);
});
test("rejects unsupported, truncated and non-finite source grids", () => {
  expect(() => readMapHeightGrid(new Uint8Array(10))).toThrow("Truncated");
  const bytes = grid();
  bytes[0] = 8;
  expect(() => readMapHeightGrid(bytes)).toThrow("Unsupported");
  bytes[0] = 7;
  expect(() => readMapHeightGrid(bytes.subarray(0, bytes.length - 1))).toThrow(
    "Invalid map height grid",
  );
  new DataView(bytes.buffer).setFloat32(bytes.length - 4, Number.NaN, true);
  expect(() => readMapHeightGrid(bytes)).toThrow("Non-finite");
});

test("normalizes only exact original field hashes and observed material paths", () => {
  const name = "Maps/MapGeometry/Map11/ActualMaterial";
  const tree = {
    schema: 1,
    reader: "scout-exact-property-bin-16.21",
    dependencies: [],
    objects: [
      {
        pathHash: mapBinHash(name),
        classHash: mapBinHash("MapContainer"),
        fields: {
          [mapBinHash("components")]: {
            type: "Container",
            elements: [
              {
                type: "Embedded",
                classHash: mapBinHash("MapNavGrid"),
                fields: {
                  [mapBinHash("NavGridPath")]: {
                    type: "String",
                    value: "original/navigation.aimesh_ngrid",
                  },
                },
              },
            ],
          },
          "01020304": { type: "String", value: "unresolved" },
        },
      },
    ],
  };
  expect(normalizeMapBin(tree, [name])[name]).toEqual({
    __type: "MapContainer",
    components: [
      { __type: "MapNavGrid", NavGridPath: "original/navigation.aimesh_ngrid" },
    ],
    "{01020304}": "unresolved",
  });
  expect(() =>
    normalizeMapBin({ ...tree, reader: "guessed-json" }, [name]),
  ).toThrow("Original typed BIN");
});
