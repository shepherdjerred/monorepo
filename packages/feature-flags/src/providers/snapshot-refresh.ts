export class SnapshotUnavailableError extends Error {}

export async function settleRefresh(
  task: Promise<unknown> | undefined,
): Promise<void> {
  try {
    await task;
  } catch {
    // The refresh owner records the failure; later requests can still recover.
  }
}

export async function observeCompletion(
  task: Promise<unknown>,
  cleanup: () => void,
): Promise<void> {
  try {
    await settleRefresh(task);
  } finally {
    cleanup();
  }
}

export function createFreshSnapshotGate(
  runRefresh: () => Promise<void>,
): () => Promise<boolean> {
  let inFlight: Promise<boolean> | undefined;
  return () => {
    if (inFlight !== undefined) return inFlight;
    const refresh = (async () => {
      try {
        await runRefresh();
        return true;
      } catch (error) {
        if (error instanceof SnapshotUnavailableError) return false;
        throw error;
      }
    })();
    inFlight = refresh;
    void observeCompletion(refresh, () => {
      if (inFlight === refresh) inFlight = undefined;
    });
    return refresh;
  };
}
