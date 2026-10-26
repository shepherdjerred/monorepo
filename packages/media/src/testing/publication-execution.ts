import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";

/** Disposable invocation capability; production obtains the expiry from the SDK. */
export function testPublicationExecution(): PublicationExecution {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const signal = new AbortController().signal;
  const wallDeadline = observed.wall + 300_000;
  const monotonicDeadline = observed.monotonic + 300_000;
  return {
    observed,
    expiresAtMs: wallDeadline,
    signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      signal.throwIfAborted();
      if (Date.now() >= wallDeadline || performance.now() >= monotonicDeadline)
        throw new Error("Synthetic publication invocation expired");
    },
  };
}
