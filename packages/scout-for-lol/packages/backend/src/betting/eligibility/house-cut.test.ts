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

  test("rounds to the nearer Buck in both directions, at any scale", () => {
    // 20% of an integer is a fifth, so an exact half never arises at this
    // rate — these pin the two directions either side of it.
    expect(cancellationHouseCut(amount(12))).toBe(2); // 2.4 down
    expect(cancellationHouseCut(amount(13))).toBe(3); // 2.6 up
    expect(cancellationHouseCut(amount(1_000_000_000_013))).toBe(
      200_000_000_003,
    );
  });
});

/**
 * The money brands stopped carrying the Int32 cap, which widened these
 * functions' legal domain to the whole safe-integer range — far past where
 * `value * HOUSE_CUT_PERCENT` still fits a double. The float form does not
 * throw on those inputs; it returns a wrong integer that is itself perfectly
 * safe, so nothing downstream can notice. These pin the exact answers.
 */
describe("percentage arithmetic stays exact across the whole money domain", () => {
  test("floors the reported case correctly instead of one Buck low", () => {
    // Math.floor((9_007_199_254_740_980 * 20) / 100) === 1_801_439_850_948_195
    expect(
      settlementHouseCut({
        matchedProfit: amount(9_007_199_254_740_980),
        isHouse: false,
      }),
    ).toBe(1_801_439_850_948_196);
  });

  // Values chosen because the float form is provably wrong on each of them.
  // Most of the domain agrees either way — a sweep of arbitrary large values
  // catches this roughly once in a thousand — so the pins have to be picked,
  // not sampled, or this suite would pass against the bug it exists to stop.
  test.each([
    [9_007_199_254_740_980, 1_801_439_850_948_196],
    [9_007_199_254_740_974, 1_801_439_850_948_194],
    [9_007_199_254_740_969, 1_801_439_850_948_193],
  ])("floors %d to %d where doubles drift", (value, expected) => {
    expect(
      settlementHouseCut({ matchedProfit: amount(value), isHouse: false }),
    ).toBe(expected);
  });

  test.each([
    [9_007_199_254_740_987, 1_801_439_850_948_197],
    [9_007_199_254_740_982, 1_801_439_850_948_196],
    [9_007_199_254_740_977, 1_801_439_850_948_195],
    [9_007_199_254_740_952, 1_801_439_850_948_190],
  ])("rounds %d to %d where doubles drift", (value, expected) => {
    expect(cancellationHouseCut(amount(value))).toBe(expected);
  });

  test("agrees with exact integer arithmetic across the top of the domain", () => {
    // Deterministic sweep, no seed: every value in a contiguous band above
    // 2^53 / HOUSE_CUT_PERCENT, which is where the product stops being
    // representable and a double answer starts being a guess.
    for (let offset = 0; offset < 3000; offset += 1) {
      const value = Number.MAX_SAFE_INTEGER - offset;
      expect(
        settlementHouseCut({ matchedProfit: amount(value), isHouse: false }),
      ).toBe(Number((BigInt(value) * 20n) / 100n));
      expect(cancellationHouseCut(amount(value))).toBe(
        Number((BigInt(value) * 20n * 2n + 100n) / 200n),
      );
    }
  });

  test("a fee is never larger than the value it is charged against", () => {
    for (const value of [
      1,
      3,
      Number.MAX_SAFE_INTEGER,
      9_007_199_254_740_980,
    ]) {
      expect(
        settlementHouseCut({ matchedProfit: amount(value), isHouse: false }),
      ).toBeLessThan(value);
    }
  });
});
