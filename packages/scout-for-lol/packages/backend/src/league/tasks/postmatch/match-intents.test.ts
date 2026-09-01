import { describe, expect, test } from "vitest";
import {
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
} from "#src/league/tasks/postmatch/match-intents.ts";

function intent(matchId: string): DiscoveredMatchIntent {
  return {
    matchId,
    sourcePuuid: `puuid-${matchId}`,
    region: "AMERICA_NORTH",
    delivery: "live",
  };
}

describe("post-match discovery intent ordering", () => {
  test("globally orders player-grouped matches by completion time and match ID", async () => {
    const completionTimes = new Map([
      ["NA1_300", 300],
      ["NA1_100_B", 100],
      ["NA1_100_A", 100],
    ]);

    const ordered = await orderMatchIntentsByCompletion(
      [intent("NA1_300"), intent("NA1_100_B"), intent("NA1_100_A")],
      (match) => Promise.resolve(completionTimes.get(match.matchId)),
    );

    expect(ordered.map((match) => match.matchId)).toEqual([
      "NA1_100_A",
      "NA1_100_B",
      "NA1_300",
    ]);
  });

  test("leaves an unresolved completion time for a later discovery poll", async () => {
    const ordered = await orderMatchIntentsByCompletion(
      [intent("NA1_UNKNOWN"), intent("NA1_KNOWN")],
      (match) =>
        Promise.resolve(match.matchId === "NA1_KNOWN" ? 200 : undefined),
    );

    expect(ordered.map((match) => match.matchId)).toEqual(["NA1_KNOWN"]);
  });
});
