import { describe, expect, test } from "vitest";
import {
  QUEUE_POST_MATCH_DATA,
  queueHasPostMatchData,
  queuePostMatchNote,
  queueResultSource,
  queuesWithoutPostMatchData,
  riotWithholdsMatchResult,
} from "#src/model/competitions/queue-post-match.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";

describe("QUEUE_POST_MATCH_DATA", () => {
  test("classifies every queue type", () => {
    for (const queue of QueueTypeSchema.options) {
      expect(QUEUE_POST_MATCH_DATA[queue]).toBeDefined();
    }
  });

  test("the pre-match-only queues are the ones the lakes prove", () => {
    // Each earned its place by being watched starting and never seen ending:
    // ARAM Clash at 52 pre-match observations and 0 finished matches in prod,
    // ARAM Mayhem at 964 and 0 in beta, League Classic at 0 post-match
    // objects against 1,078 in prod.
    expect(queuesWithoutPostMatchData()).toEqual([
      "aram clash",
      "aram mayhem",
      "classic",
    ]);
  });

  test("Classic ARAM Mayhem is the exception between the two that are not", () => {
    // Three confusable names and the middle one behaves oppositely: queue 2450
    // produced 20 finished matches in prod. Matching on the word "mayhem" or
    // "classic" instead of the queue value gets this backwards.
    expect(queueHasPostMatchData("classic aram mayhem")).toBe(true);
    expect(queueHasPostMatchData("aram mayhem")).toBe(false);
    expect(queueHasPostMatchData("aram clash")).toBe(false);
    expect(queueHasPostMatchData("clash")).toBe(true);
    expect(queueHasPostMatchData("classic")).toBe(false);
  });

  test("notes only the queues that cannot be scored", () => {
    expect(queuePostMatchNote("classic")).toContain("Pre-match only");
    expect(queuePostMatchNote("aram mayhem")).toContain("cannot be scored");
    expect(queuePostMatchNote("aram clash")).toContain("cannot be scored");
    expect(queuePostMatchNote("classic aram mayhem")).toBeUndefined();
    expect(queuePostMatchNote("clash")).toBeUndefined();
    expect(queuePostMatchNote("aram")).toBeUndefined();
    expect(queuePostMatchNote("solo")).toBeUndefined();
  });
});

describe("riotWithholdsMatchResult", () => {
  test("a user-created custom lobby isn't waited for", () => {
    expect(
      riotWithholdsMatchResult({
        queueId: 0,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
      }),
    ).toBe(true);
  });

  test("live Clash uses the client at once; Riot's later id is an alias", () => {
    // Live Clash arrives as a custom game type on queue 700. Riot publishes it
    // only under a different Match-V5 id, never the live one.
    for (const queueId of [700, 720]) {
      for (const gameType of ["CUSTOM", "MATCHED_GAME"]) {
        expect(
          riotWithholdsMatchResult({
            queueId,
            gameMode: queueId === 720 ? "ARAM" : "CLASSIC",
            gameType,
          }),
        ).toBe(true);
      }
    }
    expect(queueResultSource("clash")).toBe("client");
    expect(queueResultSource("solo")).toBe("riot");
  });

  test("tournament games are not lumped in with lobbies", () => {
    expect(
      riotWithholdsMatchResult({
        queueId: 0,
        gameMode: "CLASSIC",
        gameType: "CUSTOM_GAME",
        tournamentCode: "NA0a1b2-tournament",
      }),
    ).toBe(false);
  });

  test("an unclassifiable game is not assumed to be withheld", () => {
    expect(
      riotWithholdsMatchResult({
        queueId: 99_999,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
      }),
    ).toBe(false);
  });

  test("a queue Riot never publishes isn't waited for", () => {
    expect(
      riotWithholdsMatchResult({
        queueId: 2400,
        gameMode: "KIWI",
        gameType: "MATCHED_GAME",
      }),
    ).toBe(true);
  });

  test("ranked and Arena wait for Riot to go first", () => {
    for (const queueId of [420, 1700]) {
      expect(
        riotWithholdsMatchResult({
          queueId,
          gameMode: queueId === 1700 ? "CHERRY" : "CLASSIC",
          gameType: "MATCHED_GAME",
        }),
      ).toBe(false);
    }
  });
});
