import { expect, test } from "bun:test";
import {
  canonicalDirectEmitterColor,
  DIRECT_EMITTER_COLOR_FIELD_HASH,
} from "./latest-direct-emitter-color-field.mjs";
import { mapBinHash } from "./tools/map-scene-assets.mjs";

test("exact original color hash maps its two known source labels without changing authored data", () => {
  expect(mapBinHash("Color")).toBe(DIRECT_EMITTER_COLOR_FIELD_HASH);
  expect(mapBinHash("color")).toBe(DIRECT_EMITTER_COLOR_FIELD_HASH);
  for (const value of [
    null,
    undefined,
    false,
    0,
    { __type: "ValueColor", constantValue: [0, 0.2, 0.8, 1] },
    {
      __type: "ValueColor",
      dynamics: {
        times: [0, 1],
        values: [
          [0, 0, 0, 0],
          [1, 1, 1, 1],
        ],
      },
    },
  ]) {
    const source = {
        __type: "VfxEmitterDefinitionData",
        color: value,
        unknown: 17,
      },
      projected = canonicalDirectEmitterColor(source);
    expect(projected.Color).toBe(value);
    expect(projected.unknown).toBe(17);
    expect(Object.hasOwn(projected, "color")).toBe(false);
    expect(Object.hasOwn(source, "color")).toBe(true);
    expect(Object.hasOwn(source, "Color")).toBe(false);
  }
});

test("unproved class and spelling aliases remain unchanged; duplicate original identity rejects", () => {
  for (const source of [
    { color: 0 },
    { __type: "OtherClass", color: 0 },
    { __type: "VfxEmitterDefinitionData", COLOR: 0 },
    { __type: "VfxEmitterDefinitionData", Color: null },
  ])
    expect(canonicalDirectEmitterColor(source)).toBe(source);
  for (const color of [undefined, null, { __type: "ValueColor" }])
    expect(() =>
      canonicalDirectEmitterColor({
        __type: "VfxEmitterDefinitionData",
        color,
        Color: color,
      }),
    ).toThrow("Duplicate original emitter color field 3d7e6258");
});
