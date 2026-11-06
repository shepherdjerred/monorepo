import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import type { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { createSeriesPackFeedWorkerActivities } from "#activities/media/series-pack-feed.ts";

afterEach(() => vi.restoreAllMocks());
const input = {
  schemaVersion: 1 as const,
  operationId: crypto.randomUUID(),
  sourceId: crypto.randomUUID(),
  cursor: null,
};
function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
    heartbeatTimeoutMs: 30_000,
  });
}
function runtime(
  check: (
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => void,
) {
  return {
    seriesPackFeed: {
      matchSeriesPackFeedSource: (
        _input: unknown,
        execution: PlexBindingExecution,
        budget: PublicationAuthorityReadBudget,
      ) => {
        check(execution, budget);
        return Promise.resolve({
          status: "processed" as const,
          processed: 1,
          nextCursor: null,
        });
      },
    },
  };
}

test("explicit pack feed retains its original SDK clock and single real allowance through lazy loading", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const check = vi.fn(
    (
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => {
      expect(execution.observed.wall).toBe(at);
      execution.assertActive();
      expect(budget.take).toBe(101);
      budget.consume(100);
      expect(() => budget.consume(1)).toThrow("100 total queried records");
    },
  );
  const activity = createSeriesPackFeedWorkerActivities(() => {
    clock.mockReturnValue(at + 1);
    return Promise.resolve(runtime(check));
  }).matchSeriesPackFeedSource;
  await environment(at).run(activity, input);
  expect(check).toHaveBeenCalledTimes(1);
}, 30_000);

test.each(["expired", "cancelled"] as const)(
  "a cold pack feed runtime cannot renew %s execution",
  async (state) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const env = environment(at);
    const check = vi.fn();
    const activity = createSeriesPackFeedWorkerActivities(() => {
      if (state === "expired") clock.mockReturnValue(at + 120_001);
      else env.cancel();
      return Promise.resolve(runtime(check));
    }).matchSeriesPackFeedSource;
    await expect(env.run(activity, input)).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
  },
  30_000,
);
