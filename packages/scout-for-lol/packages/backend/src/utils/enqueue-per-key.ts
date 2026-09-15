/**
 * Run a task after every earlier task queued under the same key has settled,
 * without letting an earlier failure poison the queue.
 */
export async function enqueuePerKey<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key);
  const run =
    previous === undefined
      ? task()
      : (async () => {
          await previous;
          return await task();
        })();
  const tail = (async () => {
    try {
      await run;
    } catch {
      // The caller receives this task's failure through `run`; only the tail
      // is swallowed so the next task for this key can still start.
    }
  })();
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  }
}
