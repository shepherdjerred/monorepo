/** Serialize edits by Dare so a stale in-flight refresh cannot overwrite newer state. */
const tails = new Map<string, Promise<void>>();

async function ignoreOutcome(outcome: Promise<unknown>): Promise<void> {
  try {
    await outcome;
  } catch {
    // The caller awaits the original promise and observes this rejection.
  }
}

export async function runSerialized<Result>(
  key: string,
  task: () => Promise<Result>,
): Promise<Result> {
  const prior = tails.get(key) ?? Promise.resolve();
  // The task's own errors are handled by the caller; this chain must never
  // reject, or one failure would poison every later refresh for the key.
  const outcome = (async () => {
    await prior;
    return await task();
  })();
  const current = ignoreOutcome(outcome);
  tails.set(key, current);
  try {
    return await outcome;
  } finally {
    if (tails.get(key) === current) {
      tails.delete(key);
    }
  }
}
