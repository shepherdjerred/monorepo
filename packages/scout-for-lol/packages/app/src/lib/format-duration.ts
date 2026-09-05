/**
 * How Explore renders a span of time.
 *
 * Shared by the finished durations on a tool step and the live counter on the
 * status line, so a step that took four seconds reads the same while it is
 * running as it does afterwards.
 */
export function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs.toString()} ms`
    : `${(durationMs / 1000).toFixed(1)} s`;
}
