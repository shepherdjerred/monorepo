/**
 * Cache for function rename mappings.
 * Stores results by hash of function source to avoid re-processing.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FunctionRenameMapping } from "./babel-renamer.ts";

/** Cached rename result */
export type CachedRenameResult = {
  /** Hash of the function source */
  hash: string;
  /** The rename mapping */
  mapping: FunctionRenameMapping;
  /** Timestamp when cached */
  timestamp: number;
  /** Model that generated this result */
  model: string;
};

/** Function cache for rename mappings */
export class FunctionCache {
  private readonly cacheDir: string;
  private readonly model: string;
  private readonly inMemoryCache = new Map<string, CachedRenameResult>();
  private initialized = false;

  constructor(cacheDir: string, model: string) {
    this.cacheDir = cacheDir;
    this.model = model;
  }

  /** Initialize the cache directory */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await mkdir(this.cacheDir, { recursive: true });
      this.initialized = true;
    } catch {
      // Directory might already exist
      this.initialized = true;
    }
  }

  /** Hash function source to generate cache key */
  hashFunction(source: string): string {
    // Normalize whitespace before hashing so formatting changes don't invalidate cache
    const normalized = source.replaceAll(/\s+/g, " ").trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  /** Get cache file path for a hash */
  private getCachePath(hash: string): string {
    return join(this.cacheDir, `${hash}.json`);
  }

  /** Check if a result is cached (in memory or on disk) */
  async has(hash: string): Promise<boolean> {
    // Check in-memory cache first
    if (this.inMemoryCache.has(hash)) {
      return true;
    }

    // Check disk cache
    try {
      const path = this.getCachePath(hash);
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Get cached result */
  async get(hash: string): Promise<CachedRenameResult | null> {
    // Check in-memory cache first
    const inMemory = this.inMemoryCache.get(hash);
    if (inMemory) {
      return inMemory;
    }

    // Check disk cache
    try {
      const path = this.getCachePath(hash);
      const content = await readFile(path, "utf-8");
      const result = JSON.parse(content) as CachedRenameResult;

      // Cache in memory for faster subsequent access
      this.inMemoryCache.set(hash, result);

      return result;
    } catch {
      return null;
    }
  }

  /** Store result in cache */
  async set(hash: string, mapping: FunctionRenameMapping): Promise<void> {
    const result: CachedRenameResult = {
      hash,
      mapping,
      timestamp: Date.now(),
      model: this.model,
    };

    // Store in memory
    this.inMemoryCache.set(hash, result);

    // Store on disk
    await this.init();
    const path = this.getCachePath(hash);
    await writeFile(path, JSON.stringify(result, null, 2));
  }

  /** Get multiple cached results at once */
  async getMany(hashes: string[]): Promise<Map<string, CachedRenameResult>> {
    const results = new Map<string, CachedRenameResult>();

    await Promise.all(
      hashes.map(async (hash) => {
        const result = await this.get(hash);
        if (result) {
          results.set(hash, result);
        }
      }),
    );

    return results;
  }

  /** Store multiple results at once */
  async setMany(mappings: Map<string, FunctionRenameMapping>): Promise<void> {
    await Promise.all(
      [...mappings.entries()].map(([hash, mapping]) => this.set(hash, mapping)),
    );
  }

  /** Get cache statistics */
  async getStats(): Promise<{
    inMemoryCount: number;
    diskCount: number;
  }> {
    let diskCount = 0;

    try {
      await this.init();
      const files = await readdir(this.cacheDir);
      diskCount = files.filter((f) => f.endsWith(".json")).length;
    } catch {
      // Ignore errors
    }

    return {
      inMemoryCount: this.inMemoryCache.size,
      diskCount,
    };
  }

  /** Clear in-memory cache (disk cache remains) */
  clearMemory(): void {
    this.inMemoryCache.clear();
  }
}
