import { describe, expect, test } from "vitest";
import {
  QUEUE_POST_MATCH_DATA,
  queueHasPostMatchData,
  queuePostMatchNote,
  queuesWithoutPostMatchData,
} from "#src/model/competitions/queue-post-match.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";

describe("QUEUE_POST_MATCH_DATA", () => {
  test("classifies every queue type", () => {
    for (const queue of QueueTypeSchema.options) {
      expect(QUEUE_POST_MATCH_DATA[queue]).toBeDefined();
    }
  });

  test("the pre-match-only queues are the two the lakes prove", () => {
    // Each earned its place by being watched starting and never seen ending:
    // ARAM Mayhem at 964 pre-match observations and 0 finished matches in
    // beta, League Classic at 0 post-match objects against 1,078 in prod.
    expect(queuesWithoutPostMatchData()).toEqual(["aram mayhem", "classic"]);
  });

  test("Classic ARAM Mayhem is the exception between the two that are not", () => {
    // Three confusable names and the middle one behaves oppositely: queue 2450
    // produced 20 finished matches in prod. Matching on the word "mayhem" or
    // "classic" instead of the queue value gets this backwards.
    expect(queueHasPostMatchData("classic aram mayhem")).toBe(true);
    expect(queueHasPostMatchData("aram mayhem")).toBe(false);
    expect(queueHasPostMatchData("classic")).toBe(false);
  });

  test("notes only the queues that cannot be scored", () => {
    expect(queuePostMatchNote("classic")).toContain("Pre-match only");
    expect(queuePostMatchNote("aram mayhem")).toContain("cannot be scored");
    expect(queuePostMatchNote("classic aram mayhem")).toBeUndefined();
    expect(queuePostMatchNote("aram")).toBeUndefined();
    expect(queuePostMatchNote("solo")).toBeUndefined();
  });
});
