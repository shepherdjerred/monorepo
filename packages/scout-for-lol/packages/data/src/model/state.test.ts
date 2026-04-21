import { describe, test, expect } from "bun:test";
import {
  parseQueueType,
  queueTypeToDisplayString,
  type QueueType,
} from "./state.ts";

describe("parseQueueType", () => {
  // Every queue id the parser recognises. Source of truth is
  // https://static.developer.riotgames.com/docs/lol/queues.json
  // — keep this table in sync when adding rotating modes.
  const cases: readonly (readonly [number, QueueType])[] = [
    [0, "custom"],
    [400, "draft pick"],
    [420, "solo"],
    [440, "flex"],
    [450, "aram"],
    [480, "swiftplay"],
    [490, "quickplay"],
    [700, "clash"],
    [720, "aram clash"],
    [900, "arurf"],
    [1700, "arena"],
    [1900, "urf"],
    [2300, "brawl"],
    [2400, "aram mayhem"],
    [3130, "easy doom bots"],
    [4220, "normal doom bots"],
    [4250, "hard doom bots"],
  ];

  test.each(cases)("queue id %i parses to %s", (id, expected) => {
    expect(parseQueueType(id)).toBe(expected);
  });

  test("returns undefined for unknown queue id", () => {
    expect(parseQueueType(99_999)).toBeUndefined();
  });
});

describe("queueTypeToDisplayString", () => {
  const cases: readonly (readonly [QueueType, string])[] = [
    ["solo", "ranked solo"],
    ["flex", "ranked flex"],
    ["clash", "clash"],
    ["aram clash", "ARAM clash"],
    ["aram", "ARAM"],
    ["arurf", "ARURF"],
    ["urf", "URF"],
    ["arena", "arena"],
    ["brawl", "brawl"],
    ["aram mayhem", "ARAM mayhem"],
    ["draft pick", "draft pick"],
    ["quickplay", "quickplay"],
    ["swiftplay", "swiftplay"],
    ["easy doom bots", "doom bots"],
    ["normal doom bots", "doom bots"],
    ["hard doom bots", "doom bots"],
    ["custom", "custom"],
  ];

  test.each(cases)("%s renders as %s", (queueType, expected) => {
    expect(queueTypeToDisplayString(queueType)).toBe(expected);
  });
});
