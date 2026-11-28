import { expect, test } from "bun:test";
import { reachesRiftProjectileTarget } from "./recorded-rift-projectile-terminal.mjs";

const origin = [0, 0, 0];

test("matches the archived directional crossing gate", () => {
  expect(reachesRiftProjectileTarget(origin, [1, 0, 0], [2, 0, 0])).toBe(false);
  expect(reachesRiftProjectileTarget(origin, [-2, 0, 0], [1, 0, 0])).toBe(
    false,
  );
  expect(reachesRiftProjectileTarget(origin, [0, 0, 2], [1, 0, 0])).toBe(false);
  expect(reachesRiftProjectileTarget(origin, [1, 0, 1.2], [2, 0, 0])).toBe(
    true,
  );
  expect(reachesRiftProjectileTarget(origin, [2, 0, 0], [2, 0, 1])).toBe(true);
});

test("includes each float32 tolerance boundary independently of Y", () => {
  const [epsilon, aboveEpsilon] = new Float32Array(
    new Uint32Array([0x3727c5ac, 0x3727c5ad]).buffer,
  );
  expect(
    reachesRiftProjectileTarget(origin, origin, [epsilon, 100, -epsilon]),
  ).toBe(true);
  expect(
    reachesRiftProjectileTarget(origin, origin, [aboveEpsilon, 100, -epsilon]),
  ).toBe(false);
  expect(
    reachesRiftProjectileTarget(origin, origin, [epsilon, 100, -aboveEpsilon]),
  ).toBe(false);
});

test("rejects invalid lanes even on the Y axis", () => {
  for (const invalid of [NaN, Infinity, Number.MAX_VALUE]) {
    expect(() =>
      reachesRiftProjectileTarget(origin, [0, invalid, 0], origin),
    ).toThrow(RangeError);
  }
});
