import { expect, test } from "bun:test";
import {
  DIRECT_POINT_DEFAULT_BITS,
  normalizeDirectPointEmitter,
} from "./latest-direct-effect-defaults.mjs";

test("absent birth scale uses the unit vector from the original registered emitter constructor", () => {
  expect(DIRECT_POINT_DEFAULT_BITS.birthScale0).toEqual([
    0x3f800000, 0x3f800000, 0x3f800000,
  ]);
  const source = { __type: "VfxEmitterDefinitionData" };
  expect(normalizeDirectPointEmitter(source).birthScale0).toEqual({
    __type: "ValueVector3",
    constantValue: [1, 1, 1],
  });
  expect(Object.hasOwn(source, "birthScale0")).toBe(false);
});

test("authored zero, curves and invalid declarations retain their own semantics", () => {
  for (const value of [
    { __type: "ValueVector3", constantValue: [0, 0, 0] },
    {
      __type: "ValueVector3",
      dynamics: {
        times: [0, 1],
        values: [
          [0, 0, 0],
          [2, 2, 2],
        ],
      },
    },
    null,
    undefined,
    false,
  ]) {
    const source = { birthScale0: value };
    expect(normalizeDirectPointEmitter(source).birthScale0).toBe(value);
    expect(source.birthScale0).toBe(value);
  }
});
