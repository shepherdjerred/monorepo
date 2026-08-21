import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import {
  addInt32,
  probabilityForSide,
  quoteParlayPosition,
} from "#src/betting/parlay-odds.ts";

describe("parlay odds", () => {
  test("uses complementary YES and NO probabilities", () => {
    expect(probabilityForSide(3500, "YES")).toBe(3500);
    expect(probabilityForSide(3500, "NO")).toBe(6500);
  });

  test("ceil-quotes the total position and avoids incremental rounding", () => {
    expect(
      quoteParlayPosition({
        totalStake: 1,
        yesProbabilityBps: 3333,
        side: "YES",
      }),
    ).toEqual({
      sideProbabilityBps: 3333,
      grossPayout: 4,
      houseReserve: 3,
    });
    expect(
      quoteParlayPosition({
        totalStake: 2,
        yesProbabilityBps: 3333,
        side: "YES",
      }),
    ).toEqual({ sideProbabilityBps: 3333, grossPayout: 7, houseReserve: 5 });
  });

  test("refuses results beyond Int32 storage", () => {
    expect(addInt32(BUCKS_INT32_MAX, 1)).toBeUndefined();
    expect(
      quoteParlayPosition({
        totalStake: BUCKS_INT32_MAX,
        yesProbabilityBps: 1000,
        side: "YES",
      }),
    ).toBeUndefined();
  });
});
