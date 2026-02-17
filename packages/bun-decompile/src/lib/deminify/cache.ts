/**
 * File-based cache for de-minification results.
 *
 * Error handling strategy:
 * - Read errors (file missing, parse error): return null (cache miss)
 * - Write errors: silently ignored, operation continues without caching
 * - Directory creation errors: ignored if dir already exists
 *
 * This "fail-safe" approach ensures caching never blocks de-minification.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CacheEntry, DeminifyResult, ExtractedFunction } from "./types.ts";

/** File-based cache for de-minification results */
export class DeminifyCache {
  private readonly cacheDir: string;
  private readonly modelVersion: string;
  private readonly memoryCache: Map<string, CacheEntry>;
  private initialized = false;

  constructor(cacheDir: string, modelVersion: string) {
    this.cacheDir = cacheDir;
    this.modelVersion = modelVersion;
    this.memoryCache = new Map();
  }

  /** Initialize the cache directory */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await mkdir(this.cacheDir, { recursive: true });
      this.initialized = true;
    } catch {
      // Directory may already exist
      this.initialized = true;
    }
  }

  /** Get cached result for a function */
  async get(func: ExtractedFunction): Promise<DeminifyResult | null> {
    const key = this.getCacheKey(func);

    // Check memory cache first
    const memEntry = this.memoryCache.get(key);
    if (memEntry?.modelVersion === this.modelVersion) {
      return memEntry.result;
    }

    // Check file cache
    await this.ensureInitialized();
    const filePath = this.getCacheFilePath(key);

    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const content = await file.text();
        const entry = JSON.parse(content) as CacheEntry;

        // Verify model version matches
        if (entry.modelVersion === this.modelVersion) {
          // Add to memory cache
          this.memoryCache.set(key, entry);
          return entry.result;
        }
      }
    } catch {
      // Cache miss or read error
    }

    return null;
  }

  /** Store result in cache */
  async set(func: ExtractedFunction, result: DeminifyResult): Promise<void> {
    const key = this.getCacheKey(func);
    const entry: CacheEntry = {
      hash: key,
      result,
      timestamp: Date.now(),
      modelVersion: this.modelVersion,
    };

    // Update memory cache
    this.memoryCache.set(key, entry);

    // Write to file cache
    await this.ensureInitialized();
    const filePath = this.getCacheFilePath(key);

    try {
      await Bun.write(filePath, JSON.stringify(entry, null, 2));
    } catch {
      // Write error, continue without caching
    }
  }

  /** Generate cache key for a function */
  getCacheKey(func: ExtractedFunction): string {
    // Hash based on function source (context-independent)
    // Functions with the same source will have the same de-minified result
    return hashSource(func.source);
  }

  /** Get file path for a cache key */
  private getCacheFilePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  /** Clear expired entries */
  async prune(maxAgeMs: number): Promise<number> {
    await this.ensureInitialized();

    let pruned = 0;
    const now = Date.now();

    try {
      const glob = new Bun.Glob("*.json");
      for await (const file of glob.scan(this.cacheDir)) {
        const filePath = join(this.cacheDir, file);
        try {
          const content = await Bun.file(filePath).text();
          const entry = JSON.parse(content) as CacheEntry;

          if (now - entry.timestamp > maxAgeMs) {
            await Bun.write(filePath, ""); // Clear file
            pruned++;
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Glob error, skip pruning
    }

    // Clear memory cache of old entries
    for (const [key, entry] of this.memoryCache) {
      if (now - entry.timestamp > maxAgeMs) {
        this.memoryCache.delete(key);
      }
    }

    return pruned;
  }

  /** Clear all cache */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    await this.ensureInitialized();

    try {
      const glob = new Bun.Glob("*.json");
      for await (const file of glob.scan(this.cacheDir)) {
        const filePath = join(this.cacheDir, file);
        try {
          await Bun.write(filePath, ""); // Clear file
        } catch {
          // Skip files that can't be cleared
        }
      }
    } catch {
      // Glob error, skip clearing
    }
  }

  /** Get cache statistics */
  async getStats(): Promise<{
    memoryCacheSize: number;
    fileCacheSize: number;
    totalSize: number;
  }> {
    await this.ensureInitialized();

    let fileCacheSize = 0;

    try {
      const glob = new Bun.Glob("*.json");
      for await (const file of glob.scan(this.cacheDir)) {
        const filePath = join(this.cacheDir, file);
        try {
          const stat = Bun.file(filePath).size;
          if (stat > 0) {
            fileCacheSize++;
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Glob error
    }

    return {
      memoryCacheSize: this.memoryCache.size,
      fileCacheSize,
      totalSize: this.memoryCache.size + fileCacheSize,
    };
  }
}

/** Hash function source for cache key */
export function hashSource(source: string): string {
  // Use Bun's built-in hasher for fast hashing
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(source);
  return hasher.digest("hex").slice(0, 16); // Use first 16 chars
}

/**
 * Check if a function should be cached.
 *
 * Caching strategy rationale:
 * - Functions are cached based on source code only (context-independent).
 * - The thresholds below are heuristics tuned for typical minified code:
 *
 * 1. Callee count ≤2: Functions calling 0-2 other functions are usually
 *    self-contained utilities (formatters, validators, helpers). Their
 *    de-minified names don't depend much on caller context.
 *
 * 2. Small functions (<500 chars) with ≤5 callees: Even with moderate
 *    dependencies, small functions have limited semantic scope. The LLM
 *    can usually infer purpose from the code alone.
 *
 * 3. Large functions with many callees: These are context-sensitive.
 *    A function calling 10+ others might be named differently depending
 *    on whether it's in a "user" module vs "admin" module.
 *
 * Future improvement: Track cache hit rates by function characteristics
 * to tune these thresholds empirically.
 */
export function shouldCache(func: ExtractedFunction): boolean {
  // Don't cache functions that are too context-dependent
  // (i.e., functions that call many external functions)

  // If function has few or no callees, it's more context-independent
  if (func.callees.length <= 2) {
    return true;
  }

  // If function is small and self-contained, cache it
  if (func.source.length < 500 && func.callees.length <= 5) {
    return true;
  }

  // Large functions with many dependencies may have different
  // de-minification results based on context, so don't cache
  return false;
}
