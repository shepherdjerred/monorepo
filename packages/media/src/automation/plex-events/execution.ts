export type WatchExecution = {
  signal: AbortSignal;
  assertActive: () => void;
  checkpoint: () => Promise<void>;
};

export function assertWatchActive(execution: WatchExecution): void {
  execution.signal.throwIfAborted();
  execution.assertActive();
}

export async function watchCheckpoint(
  execution: WatchExecution,
): Promise<void> {
  assertWatchActive(execution);
  await execution.checkpoint();
  assertWatchActive(execution);
}

/** Synchronous authority checks surround awaited database work, including lock waits. */
export async function watchAwait<T>(
  execution: WatchExecution,
  work: PromiseLike<T>,
): Promise<T> {
  assertWatchActive(execution);
  const result = await work;
  assertWatchActive(execution);
  return result;
}
