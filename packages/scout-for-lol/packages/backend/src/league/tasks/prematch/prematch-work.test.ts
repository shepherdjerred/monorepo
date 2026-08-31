import { describe, expect, test } from "vitest";
import { shouldAcquirePrematchRanks } from "#src/league/tasks/prematch/prematch-work.ts";

describe("shouldAcquirePrematchRanks", () => {
  test("skips ineligible games without a delivery destination", () => {
    expect(
      shouldAcquirePrematchRanks({
        deliveryChannelCount: 0,
      }),
    ).toBe(false);
  });

  test("acquires when presentation has a delivery destination", () => {
    for (const input of [{ deliveryChannelCount: 1 }]) {
      expect(shouldAcquirePrematchRanks(input)).toBe(true);
    }
  });
});
