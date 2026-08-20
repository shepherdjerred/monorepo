import { describe, expect, test } from "bun:test";
import {
  cancellationHouseCut,
  settlementHouseCut,
} from "#src/betting/house-cut.ts";

describe("settlementHouseCut", () => {
  test("takes twenty percent of matched profit and rounds down", () => {
    expect(settlementHouseCut({ matchedProfit: 10, isHouse: false })).toBe(2);
    expect(settlementHouseCut({ matchedProfit: 9, isHouse: false })).toBe(1);
  });

  test("keeps a one-Buck win profitable", () => {
    expect(settlementHouseCut({ matchedProfit: 1, isHouse: false })).toBe(0);
  });

  test("never charges the house itself", () => {
    expect(settlementHouseCut({ matchedProfit: 100, isHouse: true })).toBe(0);
  });
});

describe("cancellationHouseCut", () => {
  test("charges the rounded rate against the complete offer", () => {
    expect(cancellationHouseCut(1)).toBe(0);
    expect(cancellationHouseCut(2)).toBe(0);
    expect(cancellationHouseCut(3)).toBe(1);
    expect(cancellationHouseCut(5)).toBe(1);
    expect(cancellationHouseCut(10)).toBe(2);
  });
});
