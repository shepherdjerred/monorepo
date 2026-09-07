import { describe, expect, test } from "vitest";
import {
  shouldShowMatchHistoryPager,
  shouldShowPlayerPerformanceBlank,
} from "#src/components/player/recorded-match-history.tsx";
import {
  isFreshConsumerProfileAccess,
  PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
} from "#src/routes/consumer-player-profile.tsx";

describe("consumer profile authorization cache", () => {
  test("does not render a cached access success during its membership recheck", () => {
    expect(isFreshConsumerProfileAccess("available", true, true)).toBe(false);
    expect(isFreshConsumerProfileAccess("available", true, false)).toBe(true);
    expect(isFreshConsumerProfileAccess("no_shared_guild", true, false)).toBe(
      false,
    );
  });

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

  test("does not retain protected profile responses after route unmount", () => {
    expect(PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    });
  });
});
