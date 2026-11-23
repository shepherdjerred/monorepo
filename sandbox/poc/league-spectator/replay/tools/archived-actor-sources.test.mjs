import { expect, test } from "bun:test";
import { isOriginalActorNamespacePath } from "./archived-actor-sources.mjs";

test("original long Multi_Skins WAD names retain namespace lookup without becoming host paths", () => {
  const file = `DATA/Characters/Ahri/Ahri_Multi_${"Skins_Skin15_".repeat(100)}.bin`;
  expect(file.length).toBeGreaterThan(1024);
  expect(isOriginalActorNamespacePath(file)).toBe(true);
  for (const input of [
    `data/${"x".repeat(4096)}.bin`,
    "/data/a.bin",
    "data/../a.bin",
    "data/./a.bin",
    "data//a.bin",
    "C:/data/a.bin",
    "data\\a.bin",
    "data/%2e%2e/a.bin",
  ])
    expect(isOriginalActorNamespacePath(input)).toBe(false);
});
