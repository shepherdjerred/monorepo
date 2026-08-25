import { describe, expect, test } from "vitest";
import { resolveMemberDestination } from "#src/routes/guild-picker.tsx";

describe("member destination", () => {
  test.each([
    {
      label: "Explore and profiles",
      exploreAvailable: true,
      profilesAvailable: true,
      expected: "/explore",
    },
    {
      label: "Explore only",
      exploreAvailable: true,
      profilesAvailable: false,
      expected: "/explore",
    },
    {
      label: "profiles only",
      exploreAvailable: false,
      profilesAvailable: true,
      expected: "/players",
    },
    {
      label: "neither member feature",
      exploreAvailable: false,
      profilesAvailable: false,
      expected: null,
    },
  ])("chooses the member door for $label", (input) => {
    expect(resolveMemberDestination(input)).toBe(input.expected);
  });
});
