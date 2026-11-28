import { describe, expect, test } from "vitest";
import {
  PATCH_CHANGES_ASSET,
  generatePatchChangesJson,
} from "./generate-patch-changes.ts";
import {
  getPatchChanges,
  patchChanges,
} from "#src/data-dragon/patch-changes.ts";

describe("patch-changes.generated.json", () => {
  test("is exactly what the archive generates", async () => {
    expect(await Bun.file(PATCH_CHANGES_ASSET).text()).toBe(
      await generatePatchChangesJson(),
    );
  });

  test("lists the newest patch first and keeps every archived patch", () => {
    const patches = [...new Set(patchChanges.map((line) => line.patch))];
    expect(patches).toEqual([
      "26.23",
      "26.22",
      "26.21",
      "26.20",
      "26.19",
      "26.18",
      "26.17",
      "26.16",
      "26.15",
      "26.14",
    ]);
  });

  test("looks up one champion across patches", () => {
    const aatrox = getPatchChanges("champion", 266);
    expect(aatrox.length).toBeGreaterThan(0);
    expect(aatrox.every((line) => line.subject.name === "Aatrox")).toBe(true);
    expect(aatrox.some((line) => line.patch === "26.19")).toBe(true);
  });
});
