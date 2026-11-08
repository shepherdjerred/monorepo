import { expect, test } from "bun:test";
import { directDefaultParticlePalette } from "./latest-direct-particle-palette.mjs";

test("default palette retains packed age and constant-one coordinates", () => {
  for (const [fraction, half] of [
    [0, 0],
    [0.25, 0x3400],
    [0.5, 0x3800],
    [1, 0x3c00],
  ])
    expect([...directDefaultParticlePalette(fraction)]).toEqual([half, 0x3c00]);
  const a = directDefaultParticlePalette(0.5);
  a[0] = 0;
  expect(directDefaultParticlePalette(0.5)[0]).toBe(0x3800);
});

test("unresolved or non-live clocks cannot acquire default palette coordinates", () => {
  for (const value of [undefined, null, "0.5", NaN, Infinity, -1, 1.01])
    expect(() => directDefaultParticlePalette(value)).toThrow(
      "Explicit live particle age fraction required",
    );
});
