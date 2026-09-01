import { describe, expect, test } from "vitest";
import {
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
  type MatchCompletionResolver,
  type MatchIntentOrderResult,
} from "#src/league/tasks/postmatch/match-intents.ts";

function intent(matchId: string): DiscoveredMatchIntent {
  return {
    matchId,
    sourcePuuid: `puuid-${matchId}`,
    region: "AMERICA_NORTH",
    delivery: "live",
  };
}

function completionResolver(
  completionTimes: ReadonlyMap<string, number>,
): MatchCompletionResolver {
  return (match) => {
    const completion = completionTimes.get(match.matchId);
    if (completion === undefined) throw new Error("Missing fixture time");
    return Promise.resolve(completion);
  };
}

function requireOrdered(result: MatchIntentOrderResult) {
  expect(result.kind).toBe("ordered");
  if (result.kind !== "ordered") throw new Error("Expected ordered result");
  return result;
}

describe("post-match discovery intent ordering", () => {
  test("globally orders player-grouped matches by completion time and match ID", async () => {
    const completionTimes = new Map([
      ["NA1_300", 300],
      ["NA1_100_B", 100],
      ["NA1_100_A", 100],
    ]);

    const ordered = requireOrdered(
      await orderMatchIntentsByCompletion(
        [intent("NA1_300"), intent("NA1_100_B"), intent("NA1_100_A")],
        300,
        completionResolver(completionTimes),
      ),
    );

    expect(ordered.intents.map((match) => match.matchId)).toEqual([
      "NA1_100_A",
      "NA1_100_B",
      "NA1_300",
    ]);
    expect(ordered.deferredMatchIds).toEqual([]);
  });

  test("defers matches newer than one poll-start completion watermark", async () => {
    const completionTimes = new Map([
      ["NA1_STABLE", 999],
      ["NA1_TARGET_A_RACE", 1001],
      ["NA1_TARGET_B_RACE", 1002],
    ]);

    const ordered = requireOrdered(
      await orderMatchIntentsByCompletion(
        [
          intent("NA1_TARGET_B_RACE"),
          intent("NA1_STABLE"),
          intent("NA1_TARGET_A_RACE"),
        ],
        1000,
        completionResolver(completionTimes),
      ),
    );

    expect(ordered.intents.map((match) => match.matchId)).toEqual([
      "NA1_STABLE",
    ]);
    expect(ordered.deferredMatchIds).toEqual([
      "NA1_TARGET_B_RACE",
      "NA1_TARGET_A_RACE",
    ]);
  });

  test("withholds the whole batch when one completion time is unresolved", async () => {
    await expect(
      orderMatchIntentsByCompletion(
        [intent("NA1_UNKNOWN"), intent("NA1_KNOWN")],
        200,
        (match) =>
          Promise.resolve(match.matchId === "NA1_KNOWN" ? 200 : undefined),
      ),
    ).resolves.toEqual({ kind: "unavailable", matchId: "NA1_UNKNOWN" });
  });
});
