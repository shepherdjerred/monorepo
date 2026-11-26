import { describe, expect, test } from "vitest";
import {
  directionOfChange,
  isLowerBetter,
  overallDirection,
} from "#src/data-dragon/patch-changes-direction.ts";

describe("directionOfChange", () => {
  test("a rising damage vector is a buff", () => {
    expect(
      directionOfChange("Damage", "70 / 110 / 150", "80 / 120 / 160"),
    ).toBe("buff");
  });

  test("a falling damage vector is a nerf", () => {
    expect(directionOfChange("Base Damage", "40 / 60", "30 / 50")).toBe("nerf");
  });

  test("a falling cooldown is a buff and a rising one a nerf", () => {
    expect(
      directionOfChange(
        "Cooldown",
        "20 / 18 / 16 / 14 / 12 seconds",
        "18 / 16.5 / 15 / 13.5 / 12 seconds",
      ),
    ).toBe("buff");
    expect(
      directionOfChange(
        "Cooldown",
        "140 / 115 / 90 seconds",
        "160 / 130 / 100 seconds",
      ),
    ).toBe("nerf");
  });

  test.each([
    ["Mana Cost", "35 / 45", "40 / 50", "nerf"],
    ["Cost", "3200g", "3000g", "buff"],
    ["Recipe", "600g", "700g", "nerf"],
    ["Cast Time", "0.25 seconds", "0.2 seconds", "buff"],
    ["Cooldown Refund", "0.5s", "1s", "buff"],
  ])("%s polarity: %s to %s is a %s", (stat, before, after, expected) => {
    expect(directionOfChange(stat, before, after)).toBe(expected);
  });

  test("some numbers up and some down is an adjustment", () => {
    expect(
      directionOfChange("Attack Damage", "63 + 3.5/Level", "61 + 3.9/Level"),
    ).toBe("adjust");
  });

  test("a range reads as two numbers, not a negative", () => {
    expect(directionOfChange("Damage", "70-160", "80-170")).toBe("buff");
    expect(directionOfChange("Protection", "200 - 300", "100 - 300")).toBe(
      "nerf",
    );
  });

  test("a different shape is an adjustment", () => {
    expect(directionOfChange("Mana Cost", "30", "46 / 42 / 38")).toBe("adjust");
    expect(
      directionOfChange(
        "Damage",
        "11 - 60 (+45% AP)",
        "11 - 60 (+45% AP) (+20% bonus AD)",
      ),
    ).toBe("adjust");
  });

  test("text with no numbers is an adjustment", () => {
    expect(
      directionOfChange(
        "Build Path",
        "Hextech Alternator + Fiendish Codex",
        "Hextech Alternator + Kindlegem",
      ),
    ).toBe("adjust");
  });

  test("no numeric movement is an adjustment", () => {
    expect(directionOfChange("Damage", "10 (+5% AP)", "10 (+5% AP)")).toBe(
      "adjust",
    );
  });

  test("a negative number that moves toward zero is a buff for a penalty stat", () => {
    expect(
      directionOfChange("Critical Strike Damage Reduction", "-10%", "-5%"),
    ).toBe("buff");
  });

  test("a '% Less' value inverts the reading", () => {
    expect(
      directionOfChange(
        "First Stack Damage Against Minions",
        "50% Less",
        "45% Less",
      ),
    ).toBe("buff");
  });
});

describe("isLowerBetter", () => {
  test("flags cooldown, cost and cast time stats only", () => {
    expect(isLowerBetter("Cooldown")).toBe(true);
    expect(isLowerBetter("Duskwave Cooldown")).toBe(true);
    expect(isLowerBetter("Total Cost")).toBe(true);
    expect(isLowerBetter("Cooldown Reduction")).toBe(false);
    expect(isLowerBetter("Cooldown Refund on Hit")).toBe(false);
    expect(isLowerBetter("Damage")).toBe(false);
  });
});

describe("overallDirection", () => {
  test("buff or nerf only when every line agrees", () => {
    expect(overallDirection(["buff", "buff"])).toBe("buff");
    expect(overallDirection(["nerf"])).toBe("nerf");
    expect(overallDirection(["buff", "nerf"])).toBe("adjust");
    expect(overallDirection(["buff", "adjust"])).toBe("adjust");
    expect(overallDirection(["adjust", "adjust"])).toBe("adjust");
  });

  test("an empty subject is a contract violation", () => {
    expect(() => overallDirection([])).toThrow("at least one change line");
  });
});
