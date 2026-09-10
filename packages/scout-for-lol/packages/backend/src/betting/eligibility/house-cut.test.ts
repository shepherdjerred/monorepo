import { describe, expect, test } from "vitest";
import { BucksAmountSchema } from "@scout-for-lol/data";
import {
  cancellationHouseCut,
  settlementHouseCut,
} from "#src/betting/eligibility/house-cut.ts";

/** Both fees now take branded money, so the fixtures brand their inputs. */
const amount = (value: number) => BucksAmountSchema.parse(value);

describe("settlementHouseCut", () => {
  test("takes twenty percent of matched profit and rounds down", () => {
    expect(
      settlementHouseCut({ matchedProfit: amount(10), isHouse: false }),
    ).toBe(2);
    expect(
      settlementHouseCut({ matchedProfit: amount(9), isHouse: false }),
    ).toBe(1);
  });

  test("keeps a one-Buck win profitable", () => {
    expect(
      settlementHouseCut({ matchedProfit: amount(1), isHouse: false }),
    ).toBe(0);
  });

  test("never charges the house itself", () => {
    expect(
      settlementHouseCut({ matchedProfit: amount(100), isHouse: true }),
    ).toBe(0);
  });
});

describe("cancellationHouseCut", () => {
  test("charges the rounded rate against the complete offer", () => {
    expect(cancellationHouseCut(amount(1))).toBe(0);
    expect(cancellationHouseCut(amount(2))).toBe(0);
    expect(cancellationHouseCut(amount(3))).toBe(1);
    expect(cancellationHouseCut(amount(5))).toBe(1);
    expect(cancellationHouseCut(amount(10))).toBe(2);
  });
});
