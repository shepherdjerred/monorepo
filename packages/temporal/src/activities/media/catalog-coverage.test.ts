import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { createCatalogCoverageWorkerActivities } from "./catalog-coverage.ts";

afterEach(() => vi.restoreAllMocks());
const input: Parameters<MediaNetworkActivities["expandCatalogRequests"]>[0] = {
  operationId: "00000000-0000-4000-8000-000000000001",
  mediaId: "00000000-0000-4000-8000-000000000002",
  cursor: "library-series:start",
};

test("household coverage retains its original SDK observation across cold loading", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const env = new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
  });
  const effect = vi.fn(
    (_input: typeof input, execution: PlexBindingExecution) => {
      expect(execution.observed.wall).toBe(at);
      expect(_input).toEqual(input);
      execution.assertActive();
      return Promise.resolve({ processed: 25, nextCursor: null });
    },
  );
  const activity = createCatalogCoverageWorkerActivities(() => {
    clock.mockReturnValue(at + 1);
    return Promise.resolve({
      catalogCoverage: { expandCatalogRequests: effect },
    });
  }).expandCatalogRequests;
  expect(await env.run(activity, input)).toEqual({
    processed: 25,
    nextCursor: null,
  });
  expect(effect).toHaveBeenCalledTimes(1);
  effect.mockClear();
  clock.mockReturnValue(at);
  const expired = createCatalogCoverageWorkerActivities(() => {
    clock.mockReturnValue(at + 120_001);
    return Promise.resolve({
      catalogCoverage: { expandCatalogRequests: effect },
    });
  }).expandCatalogRequests;
  await expect(env.run(expired, input)).rejects.toMatchObject({
    type: "PlexBindingActivityFailure",
  });
  expect(effect).not.toHaveBeenCalled();
});

test("cancelling a cold household coverage load cannot project episodes", async () => {
  const at = Date.now();
  const env = new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
  });
  const effect = vi.fn(() =>
    Promise.resolve({ processed: 0, nextCursor: null }),
  );
  const activity = createCatalogCoverageWorkerActivities(() => {
    env.cancel();
    return Promise.resolve({
      catalogCoverage: { expandCatalogRequests: effect },
    });
  }).expandCatalogRequests;
  await expect(env.run(activity, input)).rejects.toThrow("cancelled");
  expect(effect).not.toHaveBeenCalled();
});
