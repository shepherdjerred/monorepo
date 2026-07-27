import { expect, test } from "bun:test";
import { sortedPresetNames } from "./generate-readme-core.ts";

test("preset names are deterministic and omit directories", () => {
  expect(sortedPresetNames(["assets/z.png", "assets/a.png"])).toEqual([
    "a.png",
    "z.png",
  ]);
});
