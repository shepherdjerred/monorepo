import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLastSuccessfulPollAt: vi.fn(),
  getReconciliationCompletedAt: vi.fn(),
  setReconciliationCompletedAt: vi.fn(),
  getBackfilledThroughAt: vi.fn(),
  setBackfilledThroughAt: vi.fn(),
  backfillMatchesToS3: vi.fn(),
  rawArchive: vi.fn(() => Promise.resolve(0)),
  clientEvidence: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("#src/scout-client/archive/reconciliation.ts", () => ({
  reconcileRawClientObservations: mocks.rawArchive,
}));
vi.mock("#src/scout-client/reconciliation.ts", () => ({
  reconcileAcceptedClientEvidence: mocks.clientEvidence,
}));

vi.mock("#src/league/tasks/recovery/app-state.ts", () => ({
  getLastSuccessfulPollAt: mocks.getLastSuccessfulPollAt,
  getReconciliationCompletedAt: mocks.getReconciliationCompletedAt,
  setReconciliationCompletedAt: mocks.setReconciliationCompletedAt,
  getBackfilledThroughAt: mocks.getBackfilledThroughAt,
  setBackfilledThroughAt: mocks.setBackfilledThroughAt,
}));
vi.mock("#src/league/tasks/recovery/offline-notification.ts", () => ({
  sendOfflineNotification: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("#src/league/tasks/recovery/backfill-to-s3.ts", () => ({
  backfillMatchesToS3: mocks.backfillMatchesToS3,
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
  // Stand in for the durable BotState checkpoint columns.
  let storedCompletedAt: Date | undefined;
  let storedBackfilledThroughAt: Date | undefined;

  beforeEach(() => {
    mocks.getLastSuccessfulPollAt.mockReset();
    mocks.getReconciliationCompletedAt.mockReset();
    mocks.setReconciliationCompletedAt.mockReset();
    mocks.getBackfilledThroughAt.mockReset();
    mocks.setBackfilledThroughAt.mockReset();
    mocks.backfillMatchesToS3.mockReset();
    mocks.rawArchive.mockReset().mockResolvedValue(0);
    mocks.clientEvidence.mockReset().mockResolvedValue(0);
    storedCompletedAt = undefined;
    storedBackfilledThroughAt = undefined;
    mocks.getBackfilledThroughAt.mockImplementation(() =>
      Promise.resolve(storedBackfilledThroughAt),
    );
    mocks.setBackfilledThroughAt.mockImplementation((date: Date) => {
      storedBackfilledThroughAt = date;
      return Promise.resolve(undefined);
    });
    // Like the real scan, a clean run is complete through 30 minutes
    // before its end.
    mocks.backfillMatchesToS3.mockImplementation((_start: Date, end: Date) =>
      Promise.resolve({
        totalMatchesSaved: 0,
        completeThrough: new Date(end.getTime() - 30 * 60 * 1000),
      }),
    );
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

  test("backfills a stalled poll's window once rather than on every run", async () => {
    const lastPollAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(lastPollAt),
    );

    await runIngestionReconciliation();
    expect(mocks.backfillMatchesToS3).toHaveBeenNthCalledWith(
      1,
      lastPollAt,
      expect.any(Date),
    );
    const firstEnd: unknown = mocks.backfillMatchesToS3.mock.calls[0]?.[1];
    expect(firstEnd).toBeInstanceOf(Date);
    const firstCutoff = storedBackfilledThroughAt;
    // Only the scanned range is recorded, not the 30-minute tail it skips.
    expect(firstCutoff?.getTime()).toBe(
      firstEnd instanceof Date ? firstEnd.getTime() - 30 * 60 * 1000 : NaN,
    );

    // The poll is still stalled, so downtime is still measured from the same
    // instant, but the next backfill starts where the last scan stopped.
    storedCompletedAt = new Date(Date.now() - 31_000);
    await runIngestionReconciliation();
    expect(mocks.backfillMatchesToS3).toHaveBeenNthCalledWith(
      2,
      firstCutoff,
      expect.any(Date),
    );
  });

  test.each([
    { phase: "raw archive", task: mocks.rawArchive },
    { phase: "client projection", task: mocks.clientEvidence },
  ])(
    "$phase failure is isolated from successful Riot downtime reconciliation",
    async ({ task }) => {
      task.mockRejectedValueOnce(new Error("Client dependency unavailable"));
      mocks.getLastSuccessfulPollAt.mockResolvedValue(
        new Date(Date.now() - 3 * 60 * 60 * 1000),
      );
      await runIngestionReconciliation();
      expect(mocks.backfillMatchesToS3).toHaveBeenCalledOnce();
      expect(mocks.setReconciliationCompletedAt).toHaveBeenCalledOnce();
    },
  );

  test("a partial backfill leaves its window to be backfilled again", async () => {
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(new Date(Date.now() - 3 * 60 * 60 * 1000)),
    );
    mocks.backfillMatchesToS3.mockResolvedValueOnce({
      totalMatchesSaved: 3,
      completeThrough: undefined,
    });

    await runIngestionReconciliation();
    expect(mocks.setBackfilledThroughAt).not.toHaveBeenCalled();
  });

  test("a failed backfill leaves its window to be backfilled again", async () => {
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(new Date(Date.now() - 3 * 60 * 60 * 1000)),
    );
    mocks.backfillMatchesToS3.mockRejectedValueOnce(new Error("riot down"));

    await expect(runIngestionReconciliation()).rejects.toThrow("riot down");
    expect(mocks.setBackfilledThroughAt).not.toHaveBeenCalled();
  });

  test("starts from the last poll when it is newer than the backfilled window", async () => {
    // An older outage was backfilled, then polling recovered and stalled
    // again: the new window starts at the newer poll, not the old mark.
    storedBackfilledThroughAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const lastPollAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mocks.getLastSuccessfulPollAt.mockImplementation(() =>
      Promise.resolve(lastPollAt),
    );

    await runIngestionReconciliation();

    expect(mocks.backfillMatchesToS3).toHaveBeenCalledWith(
      lastPollAt,
      expect.any(Date),
    );
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
