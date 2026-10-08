import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
  type MatchCompletionResolver,
  type MatchIntentOrderResult,
} from "#src/league/tasks/postmatch/match-intents.ts";

function intent(matchId: RiotMatchId): DiscoveredMatchIntent {
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
      ["NA1_9100000010", 100],
      ["NA1_9100000000", 100],
    ]);

    const ordered = requireOrdered(
      await orderMatchIntentsByCompletion(
        [
          intent(RiotMatchIdSchema.parse("NA1_300")),
          intent(RiotMatchIdSchema.parse("NA1_9100000010")),
          intent(RiotMatchIdSchema.parse("NA1_9100000000")),
        ],
        300,
        completionResolver(completionTimes),
      ),
    );

    expect(ordered.intents.map((match) => match.matchId)).toEqual([
      "NA1_9100000000",
      "NA1_9100000010",
      "NA1_300",
    ]);
    expect(ordered.intents.map((match) => match.gameEndTimestamp)).toEqual([
      100, 100, 300,
    ]);
    expect(ordered.deferredMatchIds).toEqual([]);
  });

  test("defers matches newer than one poll-start completion watermark", async () => {
    const completionTimes = new Map([
      ["NA1_9100000030", 999],
      ["NA1_9100000040", 1001],
      ["NA1_9100000050", 1002],
    ]);

    const ordered = requireOrdered(
      await orderMatchIntentsByCompletion(
        [
          intent(RiotMatchIdSchema.parse("NA1_9100000050")),
          intent(RiotMatchIdSchema.parse("NA1_9100000030")),
          intent(RiotMatchIdSchema.parse("NA1_9100000040")),
        ],
        1000,
        completionResolver(completionTimes),
      ),
    );

    expect(ordered.intents.map((match) => match.matchId)).toEqual([
      "NA1_9100000030",
    ]);
    expect(ordered.deferredMatchIds).toEqual([
      "NA1_9100000050",
      "NA1_9100000040",
    ]);
  });

  test("withholds the whole batch when one completion time is unresolved", async () => {
    await expect(
      orderMatchIntentsByCompletion(
        [
          intent(RiotMatchIdSchema.parse("NA1_9100000060")),
          intent(RiotMatchIdSchema.parse("NA1_9100000020")),
        ],
        200,
        (match) =>
          Promise.resolve(match.matchId === "NA1_9100000020" ? 200 : undefined),
      ),
    ).resolves.toEqual({ kind: "unavailable", matchId: "NA1_9100000060" });
  });
});
