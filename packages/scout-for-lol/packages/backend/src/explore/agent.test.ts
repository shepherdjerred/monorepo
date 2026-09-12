import { describe, expect, test } from "vitest";
import { matchCardReplayContext } from "#src/explore/agent.ts";

describe("matchCardReplayContext", () => {
  test("preserves card order, match IDs, and team results for follow-ups", () => {
    expect(
      matchCardReplayContext([
        {
          size: "L",
          match: {
            matchId: "NA1_5635906026",
            teams: [
              { teamId: 100, win: true, kills: 91 },
              { teamId: 200, win: false, kills: 88 },
            ],
          },
        },
        {
          size: "S",
          match: {
            matchId: "NA1_5635906025",
            teams: [
              { teamId: 100, win: false, kills: 10 },
              { teamId: 200, win: true, kills: 20 },
            ],
          },
        },
      ]),
    ).toBe(
      "\n\n[Match cards shown in order]\nCard 1 (L): NA1_5635906026; Team 100 won (91 kills); Team 200 lost (88 kills).\nCard 2 (S): NA1_5635906025; Team 100 lost (10 kills); Team 200 won (20 kills).",
    );
  });

  test("adds no replay context when the assistant showed no cards", () => {
    expect(matchCardReplayContext([])).toBe("");
  });
});
