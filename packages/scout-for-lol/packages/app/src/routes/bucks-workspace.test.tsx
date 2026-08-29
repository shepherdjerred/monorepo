import { describe, expect, test } from "vitest";
import { bucksSectionItems } from "#src/routes/bucks-workspace.tsx";

describe("bucksSectionItems", () => {
  test("lists the four sections with an exact-match overview", () => {
    expect(bucksSectionItems()).toEqual([
      { label: "Overview", to: "/bucks", end: true },
      { label: "History", to: "/bucks/history", end: false },
      { label: "Leaderboard", to: "/bucks/leaderboard", end: false },
      { label: "Settings", to: "/bucks/settings", end: false },
    ]);
  });
});
