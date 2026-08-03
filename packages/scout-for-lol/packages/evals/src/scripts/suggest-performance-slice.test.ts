import { describe, expect, test } from "bun:test";
import {
  classifyExceptionalPerformance,
  type ExceptionalGameResult,
  type ExceptionalParticipantStats,
} from "@scout-for-lol/data";

import {
  suggestPerformanceSlice,
  type SuggestedPerformanceSlice,
} from "./suggest-performance-slice.ts";

const BASE_STATS: ExceptionalParticipantStats = {
  assists: 4,
  deaths: 4,
  gameEndedInEarlySurrender: false,
  kills: 4,
  pentaKills: 0,
  quadraKills: 0,
  win: true,
};

type Scenario = {
  durationInSeconds: number;
  expectedResult: ExceptionalGameResult;
  expectedSlice: SuggestedPerformanceSlice;
  name: string;
  stats: ExceptionalParticipantStats;
};

const scenarios: Scenario[] = [
  {
    durationInSeconds: 1800,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "high KDA (20.0)",
    },
    expectedSlice: "great",
    name: "high-KDA loss",
    stats: {
      ...BASE_STATS,
      assists: 12,
      deaths: 1,
      kills: 8,
      win: false,
    },
  },
  {
    durationInSeconds: 1800,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "pentakill",
    },
    expectedSlice: "great",
    name: "pentakill loss",
    stats: { ...BASE_STATS, pentaKills: 1, win: false },
  },
  {
    durationInSeconds: 1800,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "negative",
      reason: "many deaths (11)",
    },
    expectedSlice: "terrible",
    name: "many-deaths win",
    stats: { ...BASE_STATS, deaths: 11, kills: 1, win: true },
  },
  {
    durationInSeconds: 1800,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "high KDA (20.0)",
    },
    expectedSlice: "great",
    name: "high-KDA win",
    stats: { ...BASE_STATS, assists: 12, deaths: 1, kills: 8, win: true },
  },
  {
    durationInSeconds: 1800,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "negative",
      reason: "many deaths (11)",
    },
    expectedSlice: "terrible",
    name: "many-deaths loss",
    stats: { ...BASE_STATS, deaths: 11, kills: 1, win: false },
  },
  {
    durationInSeconds: 1800,
    expectedResult: { isExceptional: false },
    expectedSlice: "average",
    name: "ordinary performance",
    stats: BASE_STATS,
  },
  {
    durationInSeconds: 2500,
    expectedResult: {
      isExceptional: true,
      performancePolarity: "neutral",
      reason: "very long game",
    },
    expectedSlice: "average",
    name: "duration-only exception",
    stats: BASE_STATS,
  },
];

describe("suggestPerformanceSlice", () => {
  test.each(scenarios)(
    "maps $name from classifier polarity to $expectedSlice",
    ({ durationInSeconds, expectedResult, expectedSlice, stats }) => {
      const exceptional = classifyExceptionalPerformance(
        stats,
        durationInSeconds,
      );

      expect(exceptional).toEqual(expectedResult);
      expect(suggestPerformanceSlice(exceptional)).toBe(expectedSlice);
    },
  );
});
