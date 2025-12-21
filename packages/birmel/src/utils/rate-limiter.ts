type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimits = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const limit = rateLimits.get(key);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}

export function getRateLimitRemaining(
  key: string,
  maxRequests: number,
): number {
  const limit = rateLimits.get(key);
  if (!limit || Date.now() > limit.resetAt) {
    return maxRequests;
  }
  return Math.max(0, maxRequests - limit.count);
}

export function getRateLimitResetTime(key: string): number | null {
  const limit = rateLimits.get(key);
  if (!limit || Date.now() > limit.resetAt) {
    return null;
  }
  return limit.resetAt;
}

export function clearRateLimit(key: string): void {
  rateLimits.delete(key);
}

export function clearAllRateLimits(): void {
  rateLimits.clear();
}

// Cleanup old entries periodically
export function cleanupExpiredLimits(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetAt) {
      rateLimits.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}
