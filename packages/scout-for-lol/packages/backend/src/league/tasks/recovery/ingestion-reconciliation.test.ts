import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLastSuccessfulPollAt: vi.fn(),
}));

vi.mock("#src/league/tasks/recovery/app-state.ts", () => ({
  getLastSuccessfulPollAt: mocks.getLastSuccessfulPollAt,
}));
vi.mock("#src/league/tasks/recovery/offline-notification.ts", () => ({
  sendOfflineNotification: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("#src/league/tasks/recovery/backfill-to-s3.ts", () => ({
  backfillMatchesToS3: vi.fn(() => Promise.resolve({ totalMatchesSaved: 0 })),
}));

import {
  resetReconciliationState,
  runIngestionReconciliation,
} from "#src/league/tasks/recovery/ingestion-reconciliation.ts";
import { ingestionReconciliationSkipsTotal } from "#src/metrics/recovery.ts";

async function skipCount(reason: string): Promise<number> {
  const metric = await ingestionReconciliationSkipsTotal.get();
  return (
    metric.values.find((entry) => entry.labels.reason === reason)?.value ?? 0
  );
}

describe("runIngestionReconciliation", () => {
  beforeEach(() => {
    mocks.getLastSuccessfulPollAt.mockReset();
    vi.useRealTimers();
    resetReconciliationState();
  });

  test("skips a concurrent invocation while a run is in flight", async () => {
    let releaseFirstRun: ((value: Date | undefined) => void) | undefined;
    mocks.getLastSuccessfulPollAt.mockImplementationOnce(
      () =>
        new Promise<Date | undefined>((resolve) => {
          releaseFirstRun = resolve;
        }),
    );

    const first = runIngestionReconciliation();
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(1);

    releaseFirstRun?.(new Date());
    await first;
  });

  test("skips the queue-serialized duplicate of a just-completed run", async () => {
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(new Date()),
    );
    const skipsBefore = await skipCount("recent_completion");

    await runIngestionReconciliation();
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(1);
    expect(await skipCount("recent_completion")).toBe(skipsBefore + 1);
  });

  test("runs again once the completion window has passed", async () => {
    vi.useFakeTimers();
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(new Date()),
    );

    await runIngestionReconciliation();
    vi.advanceTimersByTime(31_000);
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(2);
  });

  test("a failed run neither holds the guard nor suppresses the retry", async () => {
    mocks.getLastSuccessfulPollAt
      .mockRejectedValueOnce(new Error("database offline"))
      .mockImplementationOnce(() => Promise.resolve(new Date()));

    await expect(runIngestionReconciliation()).rejects.toThrow(
      "database offline",
    );
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(2);
  });

  test("force-resets a stale lock so recovery is not suppressed forever", async () => {
    vi.useFakeTimers();
    let releaseStuckRun: ((value: Date | undefined) => void) | undefined;
    mocks.getLastSuccessfulPollAt
      .mockImplementationOnce(
        () =>
          new Promise<Date | undefined>((resolve) => {
            releaseStuckRun = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(new Date()));

    const stuck = runIngestionReconciliation();
    vi.advanceTimersByTime(31 * 60 * 1000);
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(2);

    releaseStuckRun?.(new Date());
    await stuck;
  });
});
