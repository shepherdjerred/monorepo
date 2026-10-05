import { describe, expect, test } from "vitest";
import { fractalNoise } from "#src/dsl/mat.ts";

function samples(options?: Parameters<typeof fractalNoise>[3]): number[] {
  return Array.from({ length: 400 }, (_, index) =>
    fractalNoise(index % 20, Math.floor(index / 20), 7, options),
  );
}

describe("fractalNoise", () => {
  test("is deterministic and stays in [0, 1)", () => {
    expect(samples()).toEqual(samples());
    for (const value of [...samples(), ...samples({ ridged: true })]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("varies smoothly between neighbouring columns", () => {
    for (let x = 0; x < 60; x += 1) {
      const step = Math.abs(
        fractalNoise(x, 5, 3, { scale: 24, octaves: 1 }) -
          fractalNoise(x + 1, 5, 3, { scale: 24, octaves: 1 }),
      );
      expect(step).toBeLessThan(0.15);
    }
  });

  test("salt gives an independent field and bad options fail loudly", () => {
    expect(samples({ salt: 1 })).not.toEqual(samples());
    expect(() => fractalNoise(0, 0, 1, { scale: 0 })).toThrow(/scale > 0/u);
    expect(() => fractalNoise(0, 0, 1, { octaves: 1.5 })).toThrow(/octaves/u);
  });
});
