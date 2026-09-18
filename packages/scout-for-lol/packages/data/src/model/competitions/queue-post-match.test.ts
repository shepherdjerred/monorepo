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

  test("the pre-match-only queues are exactly the two with prod evidence", () => {
    expect(queuesWithoutPostMatchData()).toEqual(["aram mayhem", "classic"]);
  });

  test("distinguishes ARAM Mayhem from its Classic variant", () => {
    // The names differ by one word and the answers are opposite: queue 2450
    // has a captured prod Match-V5 payload, queues 2400/3200/3220/3270 have
    // never produced one. Collapsing them would silently re-enable the bug.
    expect(queueHasPostMatchData("aram mayhem")).toBe(false);
    expect(queueHasPostMatchData("classic aram mayhem")).toBe(true);
  });

  test("notes only the queues that cannot be scored", () => {
    expect(queuePostMatchNote("aram mayhem")).toContain("Pre-match only");
    expect(queuePostMatchNote("classic")).toContain("cannot be scored");
    expect(queuePostMatchNote("aram")).toBeUndefined();
    expect(queuePostMatchNote("solo")).toBeUndefined();
  });
});
