import { describe, expect, test } from "vitest";
import { consumerNavigationItems } from "#src/routes/consumer-workspace.tsx";

describe("consumer navigation", () => {
  test.each([
    {
      exploreAvailable: true,
      profilesAvailable: true,
      bucksAvailable: true,
      expected: ["Explore", "Players", "Bryan Bucks"],
    },
    {
      exploreAvailable: true,
      profilesAvailable: false,
      bucksAvailable: false,
      expected: ["Explore"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: true,
      bucksAvailable: false,
      expected: ["Players"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      bucksAvailable: true,
      expected: ["Bryan Bucks"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      bucksAvailable: false,
      expected: [],
    },
  ])("shows only enabled member features", (input) => {
    expect(consumerNavigationItems(input).map((item) => item.label)).toEqual(
      input.expected,
    );
  });
});
