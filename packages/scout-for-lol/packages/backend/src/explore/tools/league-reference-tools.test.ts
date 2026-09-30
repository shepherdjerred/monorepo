import { describe, expect, test } from "vitest";
import {
  getPatchChangeset,
  getPatchChangesets,
  items,
} from "@scout-for-lol/data";
import {
  comparePatchChangesText,
  lookupItemText,
  lookupRuneText,
  lookupSummonerSpellText,
} from "./league-reference-tools.ts";
import { resolveMasteryChampionName } from "./riot-player-tools.ts";

describe("League reference tools", () => {
  test("returns rune details from bundled Data Dragon data", () => {
    const result = lookupRuneText({ rune: "Electrocute" });
    expect(result).toContain("Rune: Electrocute");
    expect(result).toContain("Tree: Domination");
  });

  test("returns summoner spell modes and cooldown", () => {
    const result = lookupSummonerSpellText({ spell: "Flash" });
    expect(result).toContain("Summoner spell: Flash");
    expect(result).toContain("Cooldown:");
    expect(result).toContain("Modes:");
  });

  test("returns item economy and build paths", () => {
    const result = lookupItemText({ item: "Infinity Edge", mapId: 11 });
    expect(result).toContain("Gold:");
    expect(result).toContain("Builds from:");
    expect(result).toContain("Enabled map IDs:");
  });

  test("rejects item recipes with missing catalog references", () => {
    const component = items.data["1038"];
    if (component === undefined) {
      throw new Error("Infinity Edge fixture component 1038 is missing");
    }
    delete items.data["1038"];
    try {
      expect(() => lookupItemText({ item: "3031" })).toThrow(
        "Bundled item 3031 recipe from references unknown item ID 1038",
      );
    } finally {
      items.data["1038"] = component;
    }
  });

  test("returns every exact same-name item variant for disambiguation", () => {
    const result = lookupItemText({ item: "Zephyr" });
    expect(result).toContain("Multiple item variants");
    expect(result).toContain("223172; map IDs 30");
    expect(result).toContain("663172; map IDs 11");
    expect(result).toContain("773172; map IDs 12, 453");
  });

  test("selects the Summoner's Rift item variant by map ID", () => {
    const result = lookupItemText({ item: "Zephyr", mapId: 11 });
    expect(result).toContain("Item: Zephyr (663172)");
    expect(result).toContain("PercentAttackSpeedMod=0.4");
    expect(result).not.toContain("PercentAttackSpeedMod=0.5");
  });

  test("lists structured versions when a comparison is unavailable", () => {
    const result = comparePatchChangesText({
      fromPatch: "0.0",
      toPatch: "current",
    });
    expect(result).toContain("Structured patch versions:");
  });

  test("compares the current patch with its immediate predecessor", () => {
    // Derived from the bundled history so a Data Dragon bump does not
    // invalidate the expectation; the history is ordered newest first.
    const history = getPatchChangesets();
    const current = getPatchChangeset()?.patch;
    const currentIndex = history.findIndex((patch) => patch.patch === current);
    const previous = history[currentIndex + 1]?.patch;
    if (current === undefined || previous === undefined) {
      throw new Error(
        "Bundled patch history needs a current and previous patch",
      );
    }

    const result = comparePatchChangesText({});
    expect(result).toContain(`Comparing patch ${previous} to ${current}`);
    expect(result).toContain(`Patch ${previous}:`);
    expect(result).toContain(`Patch ${current}:`);
  });
});

describe("Riot player reference integrity", () => {
  test("rejects mastery rows for champions missing from the catalog", () => {
    expect(() =>
      resolveMasteryChampionName(new Map([[1, "Annie"]]), 999),
    ).toThrow("Riot mastery references unknown champion ID 999");
  });
});
