import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callRiotOrUndefined: vi.fn(),
}));

vi.mock("#src/league/api/api.ts", () => ({
  riotClient: { match: { list: vi.fn() } },
}));
vi.mock("#src/league/api/riot-call.ts", () => ({
  callRiotOrUndefined: mocks.callRiotOrUndefined,
}));

import { fetchMatchIdsForTimeRange } from "#src/league/tasks/recovery/backfill-to-s3.ts";

describe("fetchMatchIdsForTimeRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("rejects a missing later page when a Dare target requires complete evidence", async () => {
    vi.useFakeTimers();
    const firstPage = Array.from(
      { length: 100 },
      (_, index) => `NA1_${index.toString()}`,
    );
    mocks.callRiotOrUndefined
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(undefined);

    const result = fetchMatchIdsForTimeRange({
      puuid: "a".repeat(78),
      region: "AMERICA_NORTH",
      startTimeEpochSeconds: 1,
      endTimeEpochSeconds: 2,
      requireComplete: true,
    });
    const rejection = expect(result).rejects.toThrow(
      "Match-history page 100 is unavailable for required Dare target",
    );

    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(mocks.callRiotOrUndefined).toHaveBeenCalledTimes(2);
  });
});
