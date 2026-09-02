/**
 * Serialize message refreshes per market.
 *
 * Every queued pass loads its state only after the prior edit has completed,
 * so a concurrent placement or cancellation is reflected by the final PATCH
 * rather than clobbered by a stale in-flight one.
 *
 * Keys are namespaced by caller (`pool:` vs `parlay:`) so the outcome and
 * parlay refreshes for one match run concurrently — they edit different
 * messages, and serializing them across markets would only add latency.
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
