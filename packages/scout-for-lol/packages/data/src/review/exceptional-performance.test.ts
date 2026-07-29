import { describe, expect, test } from "bun:test";

import {
  classifyExceptionalPerformance,
  type ExceptionalParticipantStats,
} from "#src/review/exceptional-performance.ts";

const BASE_STATS: ExceptionalParticipantStats = {
  assists: 4,
  deaths: 4,
  gameEndedInEarlySurrender: false,
  kills: 4,
  pentaKills: 0,
  quadraKills: 0,
  win: true,
};

describe("classifyExceptionalPerformance", () => {
  test("classifies standout good and bad performances", () => {
    expect(
      classifyExceptionalPerformance(
        { ...BASE_STATS, assists: 12, deaths: 1, kills: 8 },
        1800,
      ),
    ).toEqual({ isExceptional: true, reason: "high KDA (20.0)" });
    expect(
      classifyExceptionalPerformance(
        { ...BASE_STATS, deaths: 11, kills: 1, win: false },
        1800,
      ),
    ).toEqual({ isExceptional: true, reason: "many deaths (11)" });
  });

  test("uses the selected participant for stomp qualification", () => {
    expect(
      classifyExceptionalPerformance(
        { ...BASE_STATS, deaths: 1, kills: 2, win: true },
        900,
      ),
    ).toEqual({ isExceptional: true, reason: "fast win (stomp)" });
    expect(classifyExceptionalPerformance(BASE_STATS, 1800)).toEqual({
      isExceptional: false,
    });
  });
});
