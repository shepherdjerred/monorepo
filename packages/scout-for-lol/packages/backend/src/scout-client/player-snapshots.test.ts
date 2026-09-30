import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { parseLocalMasterySnapshot } from "./player-snapshots.ts";

const puuid = LeaguePuuidSchema.parse("p".repeat(78));

describe("parseLocalMasterySnapshot", () => {
  const row = {
    puuid,
    championId: 1,
    championLevel: 12,
    championPoints: 123_456,
    lastPlayTime: 1_700_000_000_000,
    championPointsSinceLastLevel: 100,
    championPointsUntilNextLevel: 200,
    tokensEarned: 2,
    championSeasonMilestone: 7,
    highestGrade: "S+",
    markRequiredForNextLevel: 3,
    milestoneGrades: ["S", "A"],
  };

  test("preserves the richer local mastery milestones", () => {
    expect(
      parseLocalMasterySnapshot(
        { resource: "champion_mastery", data: [row] },
        puuid,
      ),
    ).toEqual([row]);
  });

  test("rejects rows attributed to another account", () => {
    expect(
      parseLocalMasterySnapshot(
        {
          resource: "champion_mastery",
          data: [{ ...row, puuid: "q".repeat(78) }],
        },
        puuid,
      ),
    ).toBeNull();
  });
});
