import { test, expect } from "bun:test";
import {
  compileDirectAbsentRotationController as compile,
  validateDirectAbsentRotationController as validate,
  applyDirectAbsentRotationController as apply,
  DIRECT_ABSENT_ROTATION_CONTROLLER_POLICY as policy,
} from "./latest-direct-effect-absent-rotation.mjs";
const source = (flag) => ({
  primitive: { __type: "VfxPrimitiveArbitraryQuad" },
  isRotationEnabled: flag,
});

test("absent arbitrary controller retains exact authored enable and requires typed default absence", () => {
  for (const flag of [0, 1, false, true]) {
    const authored = source(flag),
      saved = structuredClone(authored),
      p = compile(authored, "arbitrary-quad");
    expect(authored).toEqual(saved);
    expect(p).toEqual({
      schema: 1,
      policy,
      enabled: Boolean(flag),
      curve: "absent",
      constant: [0, 0, 0],
    });
    expect(validate(p, authored, "arbitrary-quad", null)).toBe(true);
    expect(Object.isFrozen(p.constant)).toBe(true);
  }
  for (const change of [
    { rotation0: null },
    { rotation0: {} },
    { rotation0: undefined },
    { isRotationEnabled: 2 },
    { isRotationEnabled: "1" },
    { isRotationEnabled: null },
    { primitive: { __type: "VfxPrimitiveCameraQuad" } },
  ])
    expect(compile({ ...source(1), ...change }, "arbitrary-quad")).toBeNull();
  expect(compile(source(1), "camera-quad")).toBeNull();
  expect(
    compile({ primitive: source(1).primitive }, "arbitrary-quad"),
  ).toBeNull();
  expect(compile(Object.create(source(1)), "arbitrary-quad")).toBeNull();
});

test("absent program cannot omit, forge defaults, inherit fields or invoke source/program accessors", () => {
  const s = source(1),
    p = compile(s, "arbitrary-quad");
  for (const candidate of [
    null,
    undefined,
    { ...p, enabled: false },
    { ...p, constant: [-0, 0, 0] },
    { ...p, constant: [0, 1, 0] },
    { ...p, curve: "null" },
    { ...p, unknown: 1 },
    Object.create(p),
  ])
    expect(() => validate(candidate, s, "arbitrary-quad", null)).toThrow();
  expect(() => validate(p, s, "arbitrary-quad", {})).toThrow();
  expect(() =>
    validate(p, { ...s, rotation0: null }, "arbitrary-quad", null),
  ).toThrow();
  expect(validate(null, {}, "camera-quad", null)).toBe(false);
  let reads = 0;
  const accessor = { ...s };
  Object.defineProperty(accessor, "isRotationEnabled", {
    get() {
      reads++;
      return 1;
    },
    enumerable: true,
  });
  expect(compile(accessor, "arbitrary-quad")).toBeNull();
  const forged = { ...p };
  Object.defineProperty(forged, "constant", {
    get() {
      reads++;
      return [0, 0, 0];
    },
    enumerable: true,
  });
  expect(() => validate(forged, s, "arbitrary-quad", null)).toThrow();
  expect(reads).toBe(0);
});

test("original enabled addition and FLT_MAX bypass preserve signed-zero semantics", () => {
  const enabled = compile(source(1), "arbitrary-quad"),
    disabled = compile(source(0), "arbitrary-quad");
  for (const life of [0.2, 0.75, 4]) {
    expect(apply([0, 0, 90], enabled, life)).toEqual([0, 0, 90]);
    expect(Object.is(apply([-0, -0, 90], enabled, life)[0], 0)).toBe(true);
    expect(Object.is(apply([-0, -0, 90], disabled, life)[0], -0)).toBe(true);
  }
  expect(
    Object.is(apply([-0, -0, 90], enabled, 3.4028234663852886e38)[0], -0),
  ).toBe(true);
  for (const life of [0, -1, Infinity, NaN])
    expect(() => apply([0, 0, 90], enabled, life)).toThrow();
  expect(() => apply([0, NaN, 90], enabled, 1)).toThrow();
});
