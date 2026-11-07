import { expect, test } from "bun:test";
import {
  DIRECT_NAVMESH_FILTER_DEFAULTS as defaults,
  directNavmeshFadeParameters as fade,
  directNavmeshBlurParameters as blur,
  directNavmeshFadeSample as fadeSample,
  directNavmeshBlurSample as blurSample,
} from "./latest-direct-navmesh-filter-math.mjs";
const f = Math.fround;
test("navmesh fade uses the original static rates and float32 subtraction order", () => {
  expect(fade(1, 0)).toEqual([f(1.2), 0.5, 0, f(1.1)]);
  expect(fade(10000.1, 10000)).toEqual([
    f(f(f(10000.1) - 10000) * f(1.2)),
    f(f(f(10000.1) - 10000) * 0.5),
    0,
    f(1.1),
  ]);
  expect(fade(1, 2)).toEqual([-f(1.2), -0.5, 0, f(1.1)]);
  expect(fade(2, 2)).toEqual([0, 0, 0, f(1.1)]);
});
test("navmesh blur keeps supplied manager weights and uint32 texture dimensions", () => {
  expect(blur(256, 512, defaults)).toEqual({
    horizontal: [
      f(defaults.radius / 256),
      0,
      defaults.centerWeight,
      defaults.sideWeight,
    ],
    vertical: [
      0,
      f(defaults.radius / 512),
      defaults.centerWeight,
      defaults.sideWeight,
    ],
  });
  expect(
    blur(0xffffffff, 16777217, { radius: 2, centerWeight: 3, sideWeight: 4 })
      .vertical,
  ).toEqual([0, f(2 / f(16777217)), 3, 4]);
});
test("navmesh shader scalar operations preserve branches and exact sum association", () => {
  const p = fade(0.1, 0);
  expect(fadeSample(0, 1, p)).toBe(p[0]);
  expect(fadeSample(0.9, 0.1, p)).toBe(f(f(0.9) - p[1]));
  expect(fadeSample(0.5, 0.5, p)).toBe(0.5);
  expect(fadeSample(0, 2, p)).toBe(2);
  expect(fadeSample(0.95, 1, p)).toBe(1);
  const b = blur(256, 256, defaults).horizontal;
  expect(blurSample(0.1, 0.7, 0.9, b)).toBe(
    f(f(f(0.9) * b[3]) + f(f(f(0.7) * b[2]) + f(f(0.1) * b[3]))),
  );
});
test("navmesh math rejects malformed owned inputs without a texture or clock fallback", () => {
  for (const n of [null, undefined, true, "1", NaN, Infinity, 1e100]) {
    expect(() => fade(n, 0)).toThrow();
    expect(() => fade(0, n)).toThrow();
    expect(() => blur(1, 1, { ...defaults, radius: n })).toThrow();
  }
  for (const n of [0, -1, 1.5, 0x100000000])
    expect(() => blur(n, 256, defaults)).toThrow();
  for (const p of [undefined, null, [], Array(4), [0, 0, 0], [0, 0, 0, 1, 2]])
    expect(() => fadeSample(0, 1, p)).toThrow();
  expect(() => blur(1, 1, undefined)).toThrow();
  expect(() => blur(1, 1, { ...defaults, extra: 0 })).toThrow();
});
