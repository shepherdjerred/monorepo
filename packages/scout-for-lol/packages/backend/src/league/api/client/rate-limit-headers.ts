/**
 * Parses Riot's `X-App-Rate-Limit` / `X-App-Rate-Limit-Count` response
 * headers into structured per-window rate-limit accounting.
 *
 * Both headers share the same comma-separated `N:W` format, e.g.
 * `"20:1,100:120"` means 20 requests per 1-second window AND 100 requests
 * per 120-second window. `X-App-Rate-Limit` carries the ceiling for each
 * window; `X-App-Rate-Limit-Count` carries the current usage.
 *
 * `X-Method-Rate-Limit*` headers are intentionally not handled here.
 */

export type AppRateLimitWindow = {
  windowSeconds: number;
  count: number;
  limit: number;
};

function parseRateLimitPairs(
  header: string,
): { value: number; windowSeconds: number }[] {
  const pairs: { value: number; windowSeconds: number }[] = [];

  for (const entry of header.split(",")) {
    const [rawValue, rawWindowSeconds] = entry.split(":");
    if (rawValue === undefined || rawWindowSeconds === undefined) {
      continue;
    }

    const value = Number(rawValue.trim());
    const windowSeconds = Number(rawWindowSeconds.trim());
    if (!Number.isFinite(value) || !Number.isFinite(windowSeconds)) {
      continue;
    }

    pairs.push({ value, windowSeconds });
  }

  return pairs;
}

/**
 * Parses Riot's app rate-limit ceiling and usage headers into per-window
 * accounting, matching windows by their window-seconds key rather than by
 * array position (Riot does not guarantee the two headers list windows in
 * the same order).
 */
export function parseAppRateLimitWindows(
  headers: Headers,
): AppRateLimitWindow[] {
  const limitHeader = headers.get("x-app-rate-limit");
  const countHeader = headers.get("x-app-rate-limit-count");
  if (limitHeader === null || countHeader === null) {
    return [];
  }

  const limits = parseRateLimitPairs(limitHeader);
  const counts = parseRateLimitPairs(countHeader);

  const countsByWindow = new Map<number, number>();
  for (const count of counts) {
    countsByWindow.set(count.windowSeconds, count.value);
  }

  const windows: AppRateLimitWindow[] = [];
  for (const limit of limits) {
    const count = countsByWindow.get(limit.windowSeconds);
    if (count === undefined) {
      continue;
    }

    windows.push({
      windowSeconds: limit.windowSeconds,
      count,
      limit: limit.value,
    });
  }

  return windows;
}
