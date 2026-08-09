import { describe, expect, test } from "bun:test";
import { crossedMilestone, KARMA_MILESTONES } from "./milestones.ts";

describe("crossedMilestone", () => {
  test.each([...KARMA_MILESTONES])("detects crossing %i", (milestone) => {
    expect(crossedMilestone(milestone - 1, milestone)).toBe(milestone);
  });

  test("returns null when no threshold is passed", () => {
    expect(crossedMilestone(11, 12)).toBeNull();
    expect(crossedMilestone(0, 9)).toBeNull();
  });

  test("returns null when already past the threshold", () => {
    expect(crossedMilestone(10, 11)).toBeNull();
  });

  test("reports the highest threshold when one give clears several", () => {
    // A single large give that vaults 10, 25, and 50 should announce 50.
    expect(crossedMilestone(9, 60)).toBe(50);
  });

  test("ignores downward movement", () => {
    // Karma goes down via self-give penalties and undo; a total oscillating
    // around a threshold must not re-announce on the way back up unless it
    // genuinely crosses again.
    expect(crossedMilestone(30, 20)).toBeNull();
    expect(crossedMilestone(10, 10)).toBeNull();
  });

  test("re-announces only after dropping back below and crossing again", () => {
    expect(crossedMilestone(24, 25)).toBe(25);
    expect(crossedMilestone(25, 24)).toBeNull();
    expect(crossedMilestone(24, 25)).toBe(25);
  });
});
