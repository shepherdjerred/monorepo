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

export async function runSerialized(
  key: string,
  task: () => Promise<void>,
): Promise<void> {
  const prior = tails.get(key) ?? Promise.resolve();
  // The task's own errors are handled by the caller; this chain must never
  // reject, or one failure would poison every later refresh for the key.
  const current = (async () => {
    await prior;
    await task();
  })();
  tails.set(key, current);
  try {
    await current;
  } finally {
    if (tails.get(key) === current) {
      tails.delete(key);
    }
  }
}
