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
      (match) => {
        const completion = completionTimes.get(match.matchId);
        if (completion === undefined) throw new Error("Missing fixture time");
        return Promise.resolve(completion);
      },
    );

    expect(ordered.kind).toBe("ordered");
    if (ordered.kind !== "ordered") throw new Error("Expected ordered result");
    expect(ordered.intents.map((match) => match.matchId)).toEqual([
      "NA1_100_A",
      "NA1_100_B",
      "NA1_300",
    ]);
  });

  test("withholds the whole batch when one completion time is unresolved", async () => {
    await expect(
      orderMatchIntentsByCompletion(
        [intent("NA1_UNKNOWN"), intent("NA1_KNOWN")],
        (match) =>
          Promise.resolve(match.matchId === "NA1_KNOWN" ? 200 : undefined),
      ),
    ).resolves.toEqual({ kind: "unavailable", matchId: "NA1_UNKNOWN" });
  });
});
