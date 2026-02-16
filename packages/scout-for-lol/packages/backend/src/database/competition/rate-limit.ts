// ============================================================================
// In-Memory Rate Limit Store
// ============================================================================

/**
 * Rate limit store: Map<"serverId:userId", timestamp>
 *
 * Note: This is an in-memory store suitable for single-instance deployments.
 * For multi-instance deployments, consider using Redis.
 */
let rateLimitStore: Record<string, number> = {};

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Rate Limit Functions
// ============================================================================

/**
 * Check if user is within rate limit window
 *
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 * @returns true if user can create competition, false if rate limited
 */
export function checkRateLimit(serverId: string, userId: string): boolean {
  const key = `${serverId}:${userId}`;
  const lastCreation = rateLimitStore[key];

  if (!lastCreation) {
    return true; // No previous creation
  }

  const now = Date.now();
  const elapsed = now - lastCreation;

  return elapsed >= RATE_LIMIT_WINDOW_MS;
}

/**
 * Record competition creation timestamp for rate limiting
 *
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 */
export function recordCreation(serverId: string, userId: string): void {
  const key = `${serverId}:${userId}`;
  rateLimitStore[key] = Date.now();
}

/**
 * Get time remaining until user can create another competition
 *
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 * @returns milliseconds remaining, or 0 if not rate limited
 */
export function getTimeRemaining(serverId: string, userId: string): number {
  const key = `${serverId}:${userId}`;
  const lastCreation = rateLimitStore[key];

  if (!lastCreation) {
    return 0;
  }

  const now = Date.now();
  const elapsed = now - lastCreation;
  const remaining = RATE_LIMIT_WINDOW_MS - elapsed;

  return Math.max(0, remaining);
}

/**
 * Clear rate limit for user (useful for testing)
 *
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 */
export function clearRateLimit(serverId: string, userId: string): void {
  const key = `${serverId}:${userId}`;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Required for clearing rate limit entries
  delete rateLimitStore[key];
}

/**
 * Clear all rate limits (useful for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore = {};
}
