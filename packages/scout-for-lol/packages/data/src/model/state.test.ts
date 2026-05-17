import { describe, test, expect } from "bun:test";
import {
  isArenaQueueOrMode,
  parseQueueType,
  queueTypeToDisplayString,
  resolveQueueTypeFromGame,
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
    [3200, "aram mayhem"],
    [3270, "aram mayhem"],
    [3100, "custom"],
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

describe("Arena queue resolution", () => {
  test("treats CHERRY custom-shaped games as arena", () => {
    expect(isArenaQueueOrMode(0, "CHERRY")).toBe(true);
    expect(resolveQueueTypeFromGame(0, "CHERRY")).toBe("arena");
  });

  test("keeps ordinary custom games as custom", () => {
    expect(isArenaQueueOrMode(0, "CLASSIC")).toBe(false);
    expect(resolveQueueTypeFromGame(0, "CLASSIC")).toBe("custom");
  });

  test("treats queue 1700 as arena even with a different mode string", () => {
    expect(isArenaQueueOrMode(1700, "UNKNOWN")).toBe(true);
    expect(resolveQueueTypeFromGame(1700, "UNKNOWN")).toBe("arena");
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
