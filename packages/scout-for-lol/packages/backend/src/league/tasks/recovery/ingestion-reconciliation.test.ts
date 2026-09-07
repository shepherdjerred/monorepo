import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLastSuccessfulPollAt: vi.fn(),
  getReconciliationCompletedAt: vi.fn(),
  setReconciliationCompletedAt: vi.fn(),
}));

vi.mock("#src/league/tasks/recovery/app-state.ts", () => ({
  getLastSuccessfulPollAt: mocks.getLastSuccessfulPollAt,
  getReconciliationCompletedAt: mocks.getReconciliationCompletedAt,
  setReconciliationCompletedAt: mocks.setReconciliationCompletedAt,
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

/**
 * Hangs the next reconciliation on its first poll-state read and resolves once
 * the run has reached it, so a test can hold a run in flight deterministically.
 */
function hangNextRun() {
  let release: ((value: Date | undefined) => void) | undefined;
  const started = new Promise<void>((resolveStarted) => {
    mocks.getLastSuccessfulPollAt.mockImplementationOnce(() => {
      resolveStarted();
      return new Promise<Date | undefined>((resolve) => {
        release = resolve;
      });
    });
  });
  return {
    started,
    release: (value: Date | undefined) => {
      release?.(value);
    },
  };
}

describe("runIngestionReconciliation", () => {
  // Stands in for the durable BotState checkpoint column.
  let storedCompletedAt: Date | undefined;

  beforeEach(() => {
    mocks.getLastSuccessfulPollAt.mockReset();
    mocks.getReconciliationCompletedAt.mockReset();
    mocks.setReconciliationCompletedAt.mockReset();
    storedCompletedAt = undefined;
    mocks.getReconciliationCompletedAt.mockImplementation(() =>
      Promise.resolve(storedCompletedAt),
    );
    mocks.setReconciliationCompletedAt.mockImplementation((date: Date) => {
      storedCompletedAt = date;
      return Promise.resolve(undefined);
    });
    vi.useRealTimers();
    resetReconciliationState();
  });

  test("skips a concurrent invocation while a run is in flight", async () => {
    const hung = hangNextRun();

    const first = runIngestionReconciliation();
    await hung.started;
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(1);

    hung.release(new Date());
    await first;

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(1);
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

  test("skips the boot-time duplicate right after a restart", async () => {
    // The previous process stamped the durable checkpoint and then rolled
    // over; module state starts fresh (beforeEach reset) as after a boot.
    storedCompletedAt = new Date();
    const skipsBefore = await skipCount("recent_completion");

    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).not.toHaveBeenCalled();
    expect(await skipCount("recent_completion")).toBe(skipsBefore + 1);
  });

  test("runs after a restart when the checkpoint is stale", async () => {
    storedCompletedAt = new Date(Date.now() - 31_000);
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(new Date()),
    );

    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(1);
  });

  test("a failed run neither holds the guard nor stamps the checkpoint", async () => {
    mocks.getLastSuccessfulPollAt
      .mockRejectedValueOnce(new Error("database offline"))
      .mockImplementationOnce(() => Promise.resolve(new Date()));

    await expect(runIngestionReconciliation()).rejects.toThrow(
      "database offline",
    );
    expect(mocks.setReconciliationCompletedAt).not.toHaveBeenCalled();

    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(2);
  });

  test("force-resets a stale lock so recovery is not suppressed forever", async () => {
    vi.useFakeTimers();
    const hung = hangNextRun();
    mocks.getLastSuccessfulPollAt.mockImplementationOnce(() =>
      Promise.resolve(new Date()),
    );

    const stuck = runIngestionReconciliation();
    await hung.started;
    vi.advanceTimersByTime(31 * 60 * 1000);
    await runIngestionReconciliation();

    expect(mocks.getLastSuccessfulPollAt).toHaveBeenCalledTimes(2);

    hung.release(new Date());
    await stuck;
  });
});
