import { z } from "zod";

const EXPLORE_FINISHED_RUNS_KEY = "scout:explore-finished-runs:v1";
const MAX_FINISHED_RUNS = 100;
const FinishedRunsSchema = z.array(z.string());

function readFinishedRuns(storage: Storage): string[] {
  const stored = storage.getItem(EXPLORE_FINISHED_RUNS_KEY);
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    const result = FinishedRunsSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function claimWithoutLock(storage: Storage, runId: string): boolean {
  const finishedRuns = readFinishedRuns(storage);
  if (finishedRuns.includes(runId)) return false;
  storage.setItem(
    EXPLORE_FINISHED_RUNS_KEY,
    JSON.stringify([...finishedRuns, runId].slice(-MAX_FINISHED_RUNS)),
  );
  return true;
}

/**
 * Claim the completion event for a run across every tab on this origin.
 * Web Locks closes the check-then-set race; the storage-only path keeps the
 * event usable in browsers without Web Locks and in unit tests.
 */
export async function claimExploreRunFinished(
  runId: string,
  storage?: Storage,
): Promise<boolean> {
  try {
    const activeStorage = storage ?? globalThis.localStorage;
    const lockManager =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (lockManager === undefined) {
      return claimWithoutLock(activeStorage, runId);
    }
    return await lockManager.request(
      `scout:explore-finished:${runId}`,
      { ifAvailable: true },
      (lock) => lock !== null && claimWithoutLock(activeStorage, runId),
    );
  } catch {
    return false;
  }
}
