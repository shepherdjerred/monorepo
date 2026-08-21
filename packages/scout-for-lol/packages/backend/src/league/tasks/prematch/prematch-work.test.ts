import { describe, expect, test } from "vitest";
import { shouldAcquirePrematchRanks } from "#src/league/tasks/prematch/prematch-work.ts";

describe("shouldAcquirePrematchRanks", () => {
  test("skips ineligible games without a delivery destination", () => {
    expect(
      shouldAcquirePrematchRanks({
        predictionEligible: false,
        deliveryChannelCount: 0,
      }),
    ).toBe(false);
  });

  test("acquires once for either prediction or presentation", () => {
    for (const input of [
      { predictionEligible: true, deliveryChannelCount: 0 },
      { predictionEligible: false, deliveryChannelCount: 1 },
      { predictionEligible: true, deliveryChannelCount: 1 },
    ]) {
      expect(shouldAcquirePrematchRanks(input)).toBe(true);
    }
  });
});
