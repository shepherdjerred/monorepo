import { describe, expect, test } from "vitest";
import { orderWeeklyParlayCandidates } from "#src/betting/weekly-parlay-selection.ts";

describe("weekly parlay candidate selection", () => {
  test("applies activity, coverage, membership, and cooldown gates", () => {
    const ordered = orderWeeklyParlayCandidates([
      {
        playerId: 5,
        linkedGuildMember: true,
        recentEligibleGames: 5,
        fullyObservedWindows: 20,
        periodsSinceFeatured: null,
      },
      {
        playerId: 3,
        linkedGuildMember: true,
        recentEligibleGames: 7,
        fullyObservedWindows: 20,
        periodsSinceFeatured: 8,
      },
      {
        playerId: 2,
        linkedGuildMember: true,
        recentEligibleGames: 8,
        fullyObservedWindows: 20,
        periodsSinceFeatured: 3,
      },
      {
        playerId: 4,
        linkedGuildMember: true,
        recentEligibleGames: 8,
        fullyObservedWindows: 20,
        periodsSinceFeatured: 4,
      },
      {
        playerId: 1,
        linkedGuildMember: false,
        recentEligibleGames: 20,
        fullyObservedWindows: 52,
        periodsSinceFeatured: null,
      },
    ]);
    expect(ordered.map((candidate) => candidate.playerId)).toEqual([5, 3]);
  });

  test("breaks ties by recent games then stable player ID", () => {
    const ordered = orderWeeklyParlayCandidates([
      {
        playerId: 4,
        linkedGuildMember: true,
        recentEligibleGames: 5,
        fullyObservedWindows: 15,
        periodsSinceFeatured: 6,
      },
      {
        playerId: 2,
        linkedGuildMember: true,
        recentEligibleGames: 5,
        fullyObservedWindows: 15,
        periodsSinceFeatured: 6,
      },
      {
        playerId: 3,
        linkedGuildMember: true,
        recentEligibleGames: 6,
        fullyObservedWindows: 15,
        periodsSinceFeatured: 6,
      },
    ]);
    expect(ordered.map((candidate) => candidate.playerId)).toEqual([3, 2, 4]);
  });
});
