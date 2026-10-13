import { expect, test } from "vitest";
import { nationalDexNumber } from "./national-dex.ts";

test("maps an internal species ID to its National Dex number", () => {
  expect(nationalDexNumber(277)).toBe(252);
});

test("rejects an internal species ID without a National Dex mapping", () => {
  expect(() => nationalDexNumber(0)).toThrow(
    "species 0 has no National Dex mapping",
  );
});
