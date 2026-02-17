/**
 * Cache infrastructure for project-wide analysis tools.
 *
 * ESLint processes files one at a time, but knip and jscpd analyze entire projects.
 * This cache allows us to run the tools once and reuse results across all files.
 */

import type { KnipResults, JscpdResults } from "./tool-runner.js";

type CacheEntry<T> = {
  timestamp: number;
  results: T;
};

/**
 * Typed caches for each tool.
 */
const knipCache = new Map<string, CacheEntry<KnipResults>>();
const jscpdCache = new Map<string, CacheEntry<JscpdResults>>();

/**
 * Default cache TTL: 60 seconds.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Get or compute knip results.
 */
export function getOrComputeKnip(
  projectRoot: string,
  computeFn: () => KnipResults,
  ttlMs: number = CACHE_TTL_MS,
): KnipResults {
  const key = `${projectRoot}:knip`;
  const cached = knipCache.get(key);

  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.results;
  }

  const results = computeFn();
  knipCache.set(key, { timestamp: Date.now(), results });
  return results;
}

/**
 * Get or compute jscpd results.
 */
export function getOrComputeJscpd(
  projectRoot: string,
  computeFn: () => JscpdResults,
  ttlMs: number = CACHE_TTL_MS,
): JscpdResults {
  const key = `${projectRoot}:jscpd`;
  const cached = jscpdCache.get(key);

  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.results;
  }

  const results = computeFn();
  jscpdCache.set(key, { timestamp: Date.now(), results });
  return results;
}

/**
 * Clear all caches.
 * @lintignore - exposed for testing/debugging purposes
 */
export function clearAllCaches(): void {
  knipCache.clear();
  jscpdCache.clear();
}
