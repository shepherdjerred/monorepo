import { describe, expect, test } from "vitest";
import { consumerNavigationItems } from "#src/routes/consumer-workspace.tsx";

describe("consumer navigation", () => {
  test.each([
    {
      exploreAvailable: true,
      profilesAvailable: true,
      expected: ["Explore", "Players"],
    },
    {
      exploreAvailable: true,
      profilesAvailable: false,
      expected: ["Explore"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: true,
      expected: ["Players"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      expected: [],
    },
  ])("shows only enabled member features", (input) => {
    expect(consumerNavigationItems(input).map((item) => item.label)).toEqual(
      input.expected,
    );
  });
});
