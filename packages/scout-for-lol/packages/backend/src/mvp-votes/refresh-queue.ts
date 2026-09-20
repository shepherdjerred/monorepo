/**
 * Serialize public tally edits per (match, guild).
 *
 * Concurrent votes must not PATCH a stale embed over a later one. Keys are
 * namespaced so this queue never shares a tail with Bryan Bucks refreshes.
 */
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
