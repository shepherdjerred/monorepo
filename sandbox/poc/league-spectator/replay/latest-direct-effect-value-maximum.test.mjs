import { expect, test } from "bun:test";
import { compileDirectValueFloatMaximum as compile } from "./latest-direct-effect-value-maximum.mjs";
const value = () => ({
  __type: "ValueFloat",
  constantValue: 99,
  dynamics: {
    __type: "VfxAnimatedFloatVariableData",
    times: [0],
    values: [2],
    probabilityTables: [
      {
        __type: "VfxProbabilityTableData",
        keyTimes: [0, 0.8, 1],
        keyValues: [0.5, 0.7, 3],
      },
    ],
  },
});
test("native singleton metadata maximum excludes probability and wrapper constant", () => {
  expect(compile(value())).toEqual({
    schema: 1,
    policy: "native-value-float-maximum-v1",
    kind: "singleton-resource",
    maximum: 2,
    sourceKeyCount: 1,
    probabilityIncludedInMaximum: false,
  });
  const v = value();
  v.dynamics.values[0] = -2;
  expect(compile(v).maximum).toBe(-2);
  expect(compile({ __type: "ValueFloat", constantValue: 0.1 }).maximum).toBe(
    Math.fround(0.1),
  );
  delete v.constantValue;
  expect(compile(v).maximum).toBe(-2);
});
test("maximum gate rejects unsupported, malformed, sparse and inherited declarations", () => {
  const variants = [null, {}, { __type: "ValueFloat" }];
  for (const change of [
    (v) => {
      v.dynamics.times = [];
    },
    (v) => {
      v.dynamics.times = [0, 1];
      v.dynamics.values = [2, 3];
    },
    (v) => {
      v.dynamics.values = Array(1);
    },
    (v) => {
      v.dynamics.times[0] = null;
    },
    (v) => {
      v.dynamics.values[0] = Infinity;
    },
    (v) => {
      v.dynamics.isIntegrated = false;
    },
    (v) => {
      v.dynamics.probabilityTables = [null];
    },
    (v) => {
      v.dynamics.probabilityTables[0].keyTimes = [1, 0, 0.5];
    },
    (v) => {
      v.dynamics.probabilityTables[0].keyValues = [0.5];
    },
    (v) => {
      v.dynamics.probabilityTables[0].unknown = 0;
    },
    (v) => {
      v.dynamics.probabilityTables = Array(1);
    },
    (v) => {
      v.dynamics = Object.create(v.dynamics);
    },
    (v) => {
      v.constantValue = "2";
    },
  ]) {
    const v = value();
    change(v);
    variants.push(v);
  }
  for (const v of variants) expect(compile(v)).toBeNull();
});
