import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";

/** Disposable fixture capability; production obtains deadlines from the current SDK invocation. */
export function testPlexBindingExecution(): PlexBindingExecution {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const controller = new AbortController();
  const assertActive = () => {
    controller.signal.throwIfAborted();
    if (
      Date.now() < observed.wall ||
      Date.now() >= observed.wall + 300_000 ||
      performance.now() >= observed.monotonic + 300_000
    )
      throw new Error("Synthetic Plex binding invocation expired");
  };
  return {
    observed,
    expiresAtMs: observed.wall + 60_000,
    signal: controller.signal,
    assertActive,
    checkpoint: () => {
      assertActive();
      return Promise.resolve();
    },
  };
}
