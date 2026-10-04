import { describe, expect, test } from "vitest";
import {
  findLibraryEntry,
  listLibrary,
  searchLibrary,
} from "#src/library/library.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { compileTwice } from "./compile-twice.ts";

const registry = await loadRegistry();
const entries = await listLibrary();

describe("library catalog", () => {
  test("has curated entries with valid metadata", () => {
    expect(entries.map((entry) => entry.slug)).toEqual([
      "cottage",
      "desert-l-house",
      "market-stall",
      "nordic-two-story",
      "plaza-well",
      "small-chapel",
      "stone-bridge",
      "watchtower",
    ]);
  });

  test("searches by tag, style and text", async () => {
    const towers = await searchLibrary({ tags: ["tower"] });
    expect(towers.map((entry) => entry.slug)).toEqual([
      "small-chapel",
      "watchtower",
    ]);
    const desert = await searchLibrary({ tags: ["desert"] });
    expect(desert.map((entry) => entry.slug)).toEqual(["desert-l-house"]);
    const porches = await searchLibrary({ text: "porch" });
    expect(porches.map((entry) => entry.slug)).toContain("nordic-two-story");
    await expect(findLibraryEntry("castle")).rejects.toThrow(/available:/u);
  });
});

describe.each(entries)("library entry $slug", (entry) => {
  test("compiles deterministically with no lint errors", async () => {
    const { grid, drift, findings } = await compileTwice(
      entry.program,
      1,
      registry,
    );
    expect(drift).toBe(0);
    expect(findings).toEqual([]);
    expect(grid.size.y).toBeLessThanOrEqual(entry.meta.footprint.h + 6);
  });
});
