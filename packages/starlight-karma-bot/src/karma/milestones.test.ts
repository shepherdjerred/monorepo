import { describe, expect, test } from "vitest";
import {
  crossedUnannouncedMilestone,
  highestReachedMilestone,
  KARMA_MILESTONES,
  milestoneStateSeedsFromLedger,
} from "./milestones.ts";

describe("crossedUnannouncedMilestone", () => {
  test.each([...KARMA_MILESTONES])("detects crossing %i", (milestone) => {
    expect(crossedUnannouncedMilestone(milestone - 1, milestone, 0)).toBe(
      milestone,
    );
  });

  test("returns null when no threshold is passed", () => {
    expect(crossedUnannouncedMilestone(11, 12, 10)).toBeNull();
    expect(crossedUnannouncedMilestone(0, 9, 0)).toBeNull();
  });

  test("returns null when already past the threshold", () => {
    expect(crossedUnannouncedMilestone(10, 11, 10)).toBeNull();
  });

  test("reports the highest threshold when one give clears several", () => {
    // A single large give that vaults 10, 25, and 50 should announce 50.
    expect(crossedUnannouncedMilestone(9, 60, 0)).toBe(50);
  });

  test("ignores downward movement", () => {
    expect(crossedUnannouncedMilestone(30, 20, 25)).toBeNull();
    expect(crossedUnannouncedMilestone(10, 10, 10)).toBeNull();
  });

  test("does not re-announce after dropping below a persisted milestone", () => {
    expect(crossedUnannouncedMilestone(24, 25, 25)).toBeNull();
  });

  test("announces a higher milestone after preserving a lower high-water", () => {
    expect(crossedUnannouncedMilestone(49, 50, 25)).toBe(50);
  });
});

describe("highestReachedMilestone", () => {
  test.each([
    [0, 0],
    [9, 0],
    [10, 10],
    [49, 25],
    [500, 500],
    [900, 500],
  ])("maps %i karma to a %i high-water", (total, expected) => {
    expect(highestReachedMilestone(total)).toBe(expected);
  });
});

describe("milestoneStateSeedsFromLedger", () => {
  test("preserves an imported high-water after the balance falls", () => {
    const later = new Date("2026-01-02T00:00:00.000Z");
    const earlier = new Date("2026-01-01T00:00:00.000Z");

    expect(
      milestoneStateSeedsFromLedger([
        {
          id: 2,
          amount: -6,
          datetime: later,
          guildId: "guild",
          receiverId: "crossed-25",
        },
        {
          id: 1,
          amount: 30,
          datetime: earlier,
          guildId: "guild",
          receiverId: "crossed-25",
        },
        {
          id: 3,
          amount: 9,
          datetime: earlier,
          guildId: "guild",
          receiverId: "below-first-milestone",
        },
      ]),
    ).toEqual([
      {
        guildId: "guild",
        receiverId: "crossed-25",
        highestAnnounced: 25,
      },
    ]);
  });
});
