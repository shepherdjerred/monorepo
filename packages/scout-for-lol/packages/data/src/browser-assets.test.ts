import { describe, expect, test } from "vitest";
import {
  browserClassicChampions,
  browserModernChampions,
} from "#src/browser-assets.ts";

describe("browser champion catalogs", () => {
  test("keeps Modern and Classic champion identities separate", () => {
    const modernIds = new Set(
      browserModernChampions.map((champion) => champion.id),
    );
    const classicIds = new Set(
      browserClassicChampions.map((champion) => champion.id),
    );

    expect(browserModernChampions.length).toBeGreaterThan(0);
    expect(browserClassicChampions.length).toBeGreaterThan(0);
    expect([...modernIds].some((id) => classicIds.has(id))).toBe(false);
  });

  test.each([
    ["Modern", browserModernChampions],
    ["Classic", browserClassicChampions],
  ])("has no duplicate names within the %s picker", (_label, champions) => {
    const names = champions.map((champion) => champion.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
