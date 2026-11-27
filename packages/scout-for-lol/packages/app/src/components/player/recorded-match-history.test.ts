import { describe, expect, test } from "vitest";
import {
  shouldShowMatchHistoryPager,
  shouldShowPlayerPerformanceBlank,
} from "#src/components/player/recorded-match-history.tsx";

describe("recorded match history", () => {
  test("hides match-history paging on the empty first page", () => {
    expect(shouldShowMatchHistoryPager(0, 0)).toBe(false);
    expect(shouldShowMatchHistoryPager(0, 1)).toBe(true);
    expect(shouldShowMatchHistoryPager(3, 0)).toBe(true);
  });

  test("uses one blank note when a player has no recorded games", () => {
    expect(
      shouldShowPlayerPerformanceBlank({
        championCount: 0,
        matchCount: 0,
        historyPage: 0,
        historyPending: false,
        historyError: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPlayerPerformanceBlank({
        championCount: 0,
        matchCount: 0,
        historyPage: 0,
        historyPending: true,
        historyError: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPlayerPerformanceBlank({
        championCount: 1,
        matchCount: 0,
        historyPage: 0,
        historyPending: false,
        historyError: false,
      }),
    ).toBe(false);
  });
});
