import { describe, expect, test } from "vitest";
import {
  closestItemName,
  reportItemCatalog,
  resolveReportItem,
} from "#src/model/reports/report-query-items.ts";

describe("report query items", () => {
  test.each([
    ["Infinity Edge", "legendary"],
    ["Muramana", "legendary"],
    ["Mejai's Soulstealer", "legendary"],
    ["Doran's Blade", "starter"],
    ["World Atlas", "starter"],
    ["Berserker's Greaves", "boots"],
    ["Long Sword", "basic"],
    ["Kindlegem", "epic"],
    ["Health Potion", "consumable"],
    ["Oracle Lens", "trinket"],
  ])("%s is %s", (name, tier) => {
    expect(resolveReportItem(name)?.tier).toBe(tier);
  });

  test("names resolve without regard to case", () => {
    expect(resolveReportItem("  infinity EDGE ")?.id).toBe(3031);
    expect(resolveReportItem("Not An Item")).toBeUndefined();
  });

  test("a mode's reissue of an item counts as the item", () => {
    const arena = reportItemCatalog().find((entry) => entry.rawId === 223_031);
    expect(arena?.item).toEqual({
      id: 3031,
      name: "Infinity Edge",
      tier: "legendary",
    });
  });

  test("misspellings get a suggestion", () => {
    expect(closestItemName("infinty edge")).toBe("Infinity Edge");
    expect(closestItemName("zzzzzzzzzzzz")).toBeUndefined();
  });
});
