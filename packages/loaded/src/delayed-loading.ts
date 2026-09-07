/**
 * When to show a loading indicator.
 *
 * A spinner that appears and vanishes in a few hundred milliseconds makes the
 * UI feel slower than showing nothing. These defaults follow Material's
 * "no indicator under 200ms" band with a short hold so a spinner that does
 * appear is not a one-frame flash.
 */
export const LOADING_INDICATOR_DELAY_MS = 300;
export const LOADING_INDICATOR_MIN_DURATION_MS = 200;

export type DelayedLoadingPlan = {
  readonly visible: boolean;
  /**
   * Milliseconds from `now` until `visible` should flip, or `null` when the
   * current visibility is stable.
   */
  readonly waitMs: number | null;
};

/**
 * Pure scheduler for delayed loading indicators.
 *
 * - `busy && !visible` waits `delayMs` before becoming visible (including 0).
 * - `!busy && visible` stays visible until `minDurationMs` has elapsed since
 *   `visibleSince`, then hides.
 * - Errors and other non-busy terminals are the caller's job: pass
 *   `busy: false` and ignore `visible` when an error surface must win.
 */
export function scheduleDelayedLoading(input: {
  readonly busy: boolean;
  readonly visible: boolean;
  readonly visibleSince: number | null;
  readonly now: number;
  readonly delayMs: number;
  readonly minDurationMs: number;
}): DelayedLoadingPlan {
  if (input.busy) {
    if (input.visible || input.delayMs <= 0) {
      return { visible: true, waitMs: null };
    }
    return { visible: false, waitMs: input.delayMs };
  }
  if (!input.visible) {
    return { visible: false, waitMs: null };
  }
  const shownFor =
    input.visibleSince === null
      ? input.minDurationMs
      : input.now - input.visibleSince;
  const remaining = input.minDurationMs - shownFor;
  if (remaining <= 0) {
    return { visible: false, waitMs: null };
  }
  return { visible: true, waitMs: remaining };
}
