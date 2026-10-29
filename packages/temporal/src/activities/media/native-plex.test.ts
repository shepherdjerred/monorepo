import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { createNativePlexReviewActivities } from "./native-plex.ts";

afterEach(() => vi.restoreAllMocks());
const input = {
  planId: "00000000-0000-4000-8000-000000000001",
  operationId: "00000000-0000-4000-8000-000000000002",
};
const methods = [
  "observeNativeRecovery",
  "observeNativeQuarantine",
  "observeNativeArchive",
  "observeNativeCompensation",
] as const;
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
  observe: (
    value: typeof input,
    execution: PlexBindingExecution,
  ) => Promise<void>,
) {
  return {
    nativePlex: {
      observeNativeRecovery: observe,
      observeNativeQuarantine: observe,
      observeNativeArchive: observe,
      observeNativeCompensation: observe,
    },
  };
}

test.each(methods)(
  "%s keeps original pre-lazy proof clock and exact command IDs while permitting immutable ACK",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    let calls = 0;
    const activities = createNativePlexReviewActivities(() => {
      clock.mockReturnValue(at + 61_000);
      return Promise.resolve(
        runtime((value, execution) => {
          expect(value).toEqual(input);
          expect(execution.observed.wall).toBe(at);
          expect(execution.expiresAtMs).toBe(at + 60_000);
          execution.assertActive(); // SDK still valid; only the trusted consumer may return an immutable ACK.
          calls++;
          return Promise.resolve();
        }),
      );
    });
    await environment(at).run(activities[method], input);
    expect(calls).toBe(1);
  },
);

test.each(methods)(
  "%s retains its sanitized historical failure category on lazy initialization failure",
  async (method) => {
    const at = Date.now();
    const activities = createNativePlexReviewActivities(() =>
      Promise.reject(new Error("private query and provider address")),
    );
    const category =
      method === "observeNativeArchive"
        ? {
            type: "ArchiveActivityFailure",
            message:
              "Archive Activity failed; review protected operation status",
          }
        : method === "observeNativeCompensation"
          ? {
              type: "CompensationActivityFailure",
              message:
                "Compensation Activity failed; review protected operation status",
            }
          : {
              type: "MediaActivityFailure",
              message:
                "Media Activity failed; inspect sanitized operation status",
            };
    await expect(
      environment(at).run(activities[method], input),
    ).rejects.toMatchObject({
      ...category,
      cause: undefined,
      details: undefined,
    });
  },
);
