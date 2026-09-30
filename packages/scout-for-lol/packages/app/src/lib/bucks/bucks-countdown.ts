import { formatDurationSeconds } from "@scout-for-lol/data";

/**
 * Client countdown math for Bryan Bucks betting windows.
 *
 * The `openMarkets` response carries `serverNow`, so the countdown renders
 * against the server's clock rather than trusting the browser's. All of this
 * is cosmetic: the server rejects a stale submission with its own result kind,
 * and the UI treats that answer as authoritative.
 */

/** How far the browser clock is ahead of the server clock, in ms. */
export function computeClockSkewMs(
  serverNow: Date | string,
  receivedAtMs: number,
): number {
  return new Date(serverNow).getTime() - receivedAtMs;
}

export function remainingMs(
  closesAt: Date | string,
  nowMs: number,
  skewMs: number,
): number {
  return new Date(closesAt).getTime() - (nowMs + skewMs);
}

export function isClosed(
  closesAt: Date | string,
  nowMs: number,
  skewMs: number,
): boolean {
  return remainingMs(closesAt, nowMs, skewMs) <= 0;
}

/** MM:SS with total minutes, matching the shared Bucks duration convention. */
export function formatRemaining(ms: number): string {
  return formatDurationSeconds(Math.max(0, Math.floor(ms / 1000)));
}
