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

  test("League Classic is the only pre-match-only queue", () => {
    // One entry, because one queue has direct evidence that Riot publishes
    // nothing. Adding a queue here on the strength of "we have not seen one"
    // tells users a mode cannot be scored when it simply has not been played.
    expect(queuesWithoutPostMatchData()).toEqual(["classic"]);
  });

  test("neither Mayhem queue is treated as pre-match-only", () => {
    // Three confusable names, one of which is genuinely pre-match-only. Queue
    // 2450 has a captured prod Match-V5 payload and 2400/3200/3220/3270 behave
    // like any other event mode; only League Classic itself is the exception.
    expect(queueHasPostMatchData("aram mayhem")).toBe(true);
    expect(queueHasPostMatchData("classic aram mayhem")).toBe(true);
    expect(queueHasPostMatchData("classic")).toBe(false);
  });

  test("notes only the queue that cannot be scored", () => {
    expect(queuePostMatchNote("classic")).toContain("Pre-match only");
    expect(queuePostMatchNote("classic")).toContain("cannot be scored");
    expect(queuePostMatchNote("aram mayhem")).toBeUndefined();
    expect(queuePostMatchNote("classic aram mayhem")).toBeUndefined();
    expect(queuePostMatchNote("aram")).toBeUndefined();
    expect(queuePostMatchNote("solo")).toBeUndefined();
  });
});
