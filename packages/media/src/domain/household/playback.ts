export const MINIMUM_PLAY_MS = 120_000;
export const COMPLETION_PERCENT = 85;

export function playbackCompleted(
  progressMs: number,
  durationMs: number,
): boolean {
  return durationMs > 0 && progressMs / durationMs >= COMPLETION_PERCENT / 100;
}

/** Seeking, pauses, missed samples and retries must not manufacture watching time. */
export function playbackAdvance(input: {
  previousAt: Date;
  observedAt: Date;
  previousProgressMs: number;
  progressMs: number;
  previousState: string;
  state: string;
}): number {
  const elapsed = input.observedAt.getTime() - input.previousAt.getTime();
  if (
    elapsed <= 0 ||
    elapsed > 120_000 ||
    input.previousState !== "playing" ||
    input.state !== "playing"
  )
    return 0;
  const progress = input.progressMs - input.previousProgressMs;
  return progress <= 0 || progress > elapsed * 1.5 + 2000
    ? 0
    : Math.min(elapsed, progress);
}
