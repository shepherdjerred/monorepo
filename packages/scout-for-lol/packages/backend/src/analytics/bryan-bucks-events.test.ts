import { describe, expect, test } from "vitest";
import {
  aggregateBucksPendingStakes,
  countBucksOpenMarkets,
} from "#src/analytics/bryan-bucks-events.ts";

describe("aggregateBucksPendingStakes", () => {
  test("sums outcome, parlay, and weekly pending stakes per server", () => {
    const result = aggregateBucksPendingStakes(
      [{ stake: 10, matchedStake: 6, bucksAccount: { serverId: "s1" } }],
      [{ stake: 3, bucksAccount: { serverId: "s1" } }],
      [{ stake: 2, bucksAccount: { serverId: "s2" } }],
    );
    expect(result.get("s1")).toBe(9);
    expect(result.get("s2")).toBe(2);
  });

  test("an unmatched outcome bet counts its full stake, not the matched portion", () => {
    const result = aggregateBucksPendingStakes(
      [{ stake: 10, matchedStake: null, bucksAccount: { serverId: "s1" } }],
      [],
      [],
    );
    expect(result.get("s1")).toBe(10);
  });

  test("dare escrow counts as pending stake alongside outcome, parlay, and weekly money", () => {
    const result = aggregateBucksPendingStakes(
      [{ stake: 5, matchedStake: 5, bucksAccount: { serverId: "s1" } }],
      [{ stake: 3, bucksAccount: { serverId: "s1" } }],
      [{ stake: 2, bucksAccount: { serverId: "s1" } }],
      [{ stake: 7, bucksAccount: { serverId: "s1" } }],
    );
    expect(result.get("s1")).toBe(17);
  });

  test("dare escrow alone still attributes to the right server", () => {
    const result = aggregateBucksPendingStakes(
      [],
      [],
      [],
      [{ stake: 4, bucksAccount: { serverId: "s3" } }],
    );
    expect(result.get("s3")).toBe(4);
    expect(result.get("s1")).toBeUndefined();
  });

  test("omitting dare stakes entirely defaults to zero contribution", () => {
    const result = aggregateBucksPendingStakes(
      [{ stake: 1, matchedStake: 1, bucksAccount: { serverId: "s1" } }],
      [],
      [],
    );
    expect(result.get("s1")).toBe(1);
  });
});

describe("countBucksOpenMarkets", () => {
  test("counts open pools per server", () => {
    const result = countBucksOpenMarkets([
      { serverId: "s1" },
      { serverId: "s1" },
      { serverId: "s2" },
    ]);
    expect(result.get("s1")).toBe(2);
    expect(result.get("s2")).toBe(1);
  });
});
