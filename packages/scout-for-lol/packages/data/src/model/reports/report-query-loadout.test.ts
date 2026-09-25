import { describe, expect, test } from "vitest";
import { reportLoadoutNames } from "#src/model/reports/report-query-loadout.ts";

function nameOf(kind: string, id: number): string | undefined {
  return reportLoadoutNames().find(
    (entry) => entry.kind === kind && entry.id === id,
  )?.name;
}

describe("report loadout names", () => {
  test("runes, trees, spells and items by id", () => {
    expect(nameOf("rune", 8010)).toBe("Conqueror");
    expect(nameOf("rune_tree", 8000)).toBe("Precision");
    expect(nameOf("spell", 4)).toBe("Flash");
    expect(nameOf("spell", 14)).toBe("Ignite");
    expect(nameOf("item", 3031)).toBe("Infinity Edge");
    expect(nameOf("item", 223_031)).toBe("Infinity Edge");
  });

  test("each kind names an id once", () => {
    const keys = reportLoadoutNames().map(
      (entry) => `${entry.kind}:${entry.id.toString()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
