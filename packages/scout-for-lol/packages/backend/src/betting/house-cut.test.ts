import { describe, expect, test } from "bun:test";
import {
  cancellationHouseCut,
  settlementHouseCut,
} from "#src/betting/house-cut.ts";

describe("settlementHouseCut", () => {
  test("takes twenty percent of a normal gross payout", () => {
    expect(
      settlementHouseCut({
        grossPayout: 10,
        grossWinnings: 5,
        isHouse: false,
      }),
    ).toBe(2);
  });

  test("protects principal in a lopsided pool", () => {
    expect(
      settlementHouseCut({
        grossPayout: 101,
        grossWinnings: 1,
        isHouse: false,
      }),
    ).toBe(1);
  });

  test("rounds to the nearest whole Buck", () => {
    expect(
      settlementHouseCut({
        grossPayout: 2,
        grossWinnings: 1,
        isHouse: false,
      }),
    ).toBe(0);
    expect(
      settlementHouseCut({
        grossPayout: 3,
        grossWinnings: 2,
        isHouse: false,
      }),
    ).toBe(1);
  });

  test("never charges the house itself", () => {
    expect(
      settlementHouseCut({
        grossPayout: 100,
        grossWinnings: 50,
        isHouse: true,
      }),
    ).toBe(0);
  });
});

describe("cancellationHouseCut", () => {
  test("charges the rounded rate against the complete position", () => {
    expect(cancellationHouseCut(1)).toBe(0);
    expect(cancellationHouseCut(2)).toBe(0);
    expect(cancellationHouseCut(3)).toBe(1);
    expect(cancellationHouseCut(5)).toBe(1);
    expect(cancellationHouseCut(10)).toBe(2);
  });
});
