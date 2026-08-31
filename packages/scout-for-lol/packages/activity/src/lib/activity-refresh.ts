const REFRESH_EARLY_MILLISECONDS = 60_000;

export function customActivityRefreshDelay(
  expiresAt: string,
  nowMilliseconds: number = Date.now(),
): number {
  const expiresAtMilliseconds = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMilliseconds)) {
    throw new TypeError("Activity auth expiry is invalid");
  }
  return Math.max(
    0,
    expiresAtMilliseconds - nowMilliseconds - REFRESH_EARLY_MILLISECONDS,
  );
}
