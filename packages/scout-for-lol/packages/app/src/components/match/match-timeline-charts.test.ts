import { describe, expect, test } from "vitest";
import { hasSelectedPlayerProgression } from "#src/components/match/match-timeline-charts.tsx";

describe("hasSelectedPlayerProgression", () => {
  test("omits the neutral progression chart when every series value is absent", () => {
    expect(
      hasSelectedPlayerProgression([
        { selectedGold: null, selectedXp: null },
        { selectedGold: null, selectedXp: null },
      ]),
    ).toBe(false);
  });

  test("keeps the chart when a selected player has progression data", () => {
    expect(
      hasSelectedPlayerProgression([
        { selectedGold: 600, selectedXp: 0 },
        { selectedGold: 1300, selectedXp: 280 },
      ]),
    ).toBe(true);
  });
});
