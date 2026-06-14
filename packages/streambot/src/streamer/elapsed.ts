/**
 * Pure playback-position arithmetic, split out so it can be unit-tested without a real clock or
 * streamer. The fork's `Player.position` only reports the *segment start offset* (the last seek
 * target), not live elapsed time, so streambot tracks elapsed itself: the offset the current segment
 * started at, plus the wall-clock time since it started playing. `playStream` plays in real time, so
 * wall-clock elapsed ≈ media position (there is no pause feature to account for).
 */
export function computeElapsed(
  offsetSeconds: number,
  startedAtMs: number,
  nowMs: number,
): number {
  return Math.max(0, offsetSeconds + (nowMs - startedAtMs) / 1000);
}
