import type { WatchExecution } from "#automation/plex-events/execution.ts";

/** Explicit bounded fixture invocation; production obtains its deadline from Temporal. */
export function testWatchExecution(): WatchExecution {
  const deadline = performance.now() + 60_000;
  const signal = new AbortController().signal;
  return {
    signal,
    assertActive: () => {
      signal.throwIfAborted();
      if (performance.now() >= deadline)
        throw new Error("Fixture watch execution expired");
    },
    checkpoint: () => Promise.resolve(),
  };
}
