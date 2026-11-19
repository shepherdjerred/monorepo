type Window = {
  previousObservedAt: number;
  completedObservedAt: number;
};
type Observation = {
  watched: boolean;
  viewCount: number | null;
  observedAt: number;
};

/** A counter change belongs only to two consecutive, settled native samples of
 * the same exact association. Ordinary unchanged samples advance the baseline
 * while retaining an already proven completion window. */
export function nextNativeCompletionWindow(input: {
  current: Observation;
  previous: (Observation & { window: Window | null }) | null;
  sameAuthority: boolean;
  previousSettled: boolean;
  now: number;
  maximumAgeMs: number;
}): Window | null {
  const { current, previous } = input;
  if (
    previous === null ||
    !input.sameAuthority ||
    !input.previousSettled ||
    previous.viewCount === null ||
    current.viewCount === null ||
    !current.watched ||
    previous.observedAt > current.observedAt ||
    input.now - previous.observedAt > input.maximumAgeMs ||
    current.viewCount < previous.viewCount
  )
    return null;
  return current.viewCount > previous.viewCount
    ? {
        previousObservedAt: previous.observedAt,
        completedObservedAt: current.observedAt,
      }
    : previous.window;
}

/** Equality cannot establish ordering within a millisecond. */
export function completionAfterFence(
  window: Window | null,
  fence: number,
): boolean {
  return window !== null && window.previousObservedAt > fence;
}
