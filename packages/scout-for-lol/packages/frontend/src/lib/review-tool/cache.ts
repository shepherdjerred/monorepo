/**
 * Client-side caching for CloudFlare R2 API calls
 * Uses a two-tier cache system:
 * 1. Memory (fastest, session-only)
 * 2. IndexedDB (fast, large capacity ~100s of MB)
 */
import { z } from "zod";

type CacheEntry = {
  data: unknown;
  timestamp: number;
  ttl: number;
};

const IDBOpenDBRequestSchema = z.instanceof(IDBOpenDBRequest);

// Schema for validating IDBRequest event targets with cursor results
const IDBRequestEventTargetSchema = z.object({
  result: z.union([z.instanceof(IDBCursorWithValue), z.null()]),
});

const CACHE_KEY_PREFIX = "r2-cache-";
const DB_NAME = "r2-cache-db";
const DB_VERSION = 1;
const STORE_NAME = "cache-entries";

/**
 * In-memory cache for fast repeated access within the same session
 */
const memoryCache = new Map<string, CacheEntry>();

/**
 * IndexedDB connection (lazy initialized)
 */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB connection
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      const error = request.error;
      console.warn("IndexedDB failed to open:", error);
      reject(error ?? new Error("Cache operation failed"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const targetResult = IDBOpenDBRequestSchema.safeParse(event.target);
      if (targetResult.success) {
        const db = targetResult.data.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Create object store with key path
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          // Create index on timestamp for efficient cleanup
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      }
    };
  });

  return dbPromise;
}

/**
 * Write to IndexedDB
 */
async function setInIndexedDB(
  key: string,
  entry: CacheEntry,
): Promise<boolean> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ key, ...entry });

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        const error = request.error;
        reject(error ?? new Error("Cache operation failed"));
      };
    });
  } catch (error) {
    console.warn("IndexedDB write error:", error);
    return false;
  }
}

/**
 * Generate a cache key from request parameters
 */
function generateCacheKey(
  endpoint: string,
  params: Record<string, unknown>,
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  return `${CACHE_KEY_PREFIX}${endpoint}:${JSON.stringify(sortedParams)}`;
}

/**
 * Check if a cache entry is still valid
 */
function isCacheValid(entry: CacheEntry): boolean {
  const now = Date.now();
  return now - entry.timestamp < entry.ttl;
}

/**
 * Periodically clean up expired entries from IndexedDB (throttled to once per minute)
 */

/**
 * Get cached data if available and valid (async - checks memory and IndexedDB)
 * Returns unknown data that must be validated by the caller
 */
export async function getCachedDataAsync(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const cacheKey = generateCacheKey(endpoint, params);

  // Check in-memory cache first (fastest)
  const memoryEntry = memoryCache.get(cacheKey);
  if (memoryEntry && isCacheValid(memoryEntry)) {
    return memoryEntry.data;
  }

  // Check IndexedDB
  try {
    const db = await getDB();
    const entry = await new Promise<CacheEntry | null>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(cacheKey);

      request.onsuccess = () => {
        const result: unknown = request.result;
        if (result) {
          // Validate the structure matches what we expect with the key
          const KeyedEntrySchema = z.object({
            key: z.string(),
            data: z.unknown(),
            timestamp: z.number(),
            ttl: z.number(),
          });
          const validationResult = KeyedEntrySchema.safeParse(result);
          if (validationResult.success) {
            const { key: _key, ...rest } = validationResult.data;
            const entry: CacheEntry = {
              data: rest.data,
              timestamp: rest.timestamp,
              ttl: rest.ttl,
            };
            resolve(entry);
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        const error = request.error;
        reject(error ?? new Error("Cache operation failed"));
      };
    });

    if (entry && isCacheValid(entry)) {
      // Restore to memory cache for faster subsequent access
      memoryCache.set(cacheKey, entry);
      return entry.data;
    }
  } catch (error) {
    console.warn("IndexedDB cache read error:", error);
  }

  return null;
}

/**
 * Evict old cache entries from IndexedDB to free up space
 * Removes expired entries first, then oldest non-expired entries
 */
async function evictOldCacheEntries(
  targetBytesToFree: number,
): Promise<number> {
  try {
    const db = await getDB();
    const entries: {
      key: string;
      timestamp: number;
      size: number;
      expired: boolean;
    }[] = [];

    // Collect all cache entries with metadata
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const targetResult = IDBRequestEventTargetSchema.safeParse(
          event.target,
        );
        if (!targetResult.success) {
          resolve();
          return;
        }

        const cursor = targetResult.data.result;
        if (!cursor) {
          resolve();
          return;
        }

        const KeyedEntrySchema = z.object({
          key: z.string(),
          data: z.unknown(),
          timestamp: z.number(),
          ttl: z.number(),
        });
        const validationResult = KeyedEntrySchema.safeParse(cursor.value);
        if (validationResult.success) {
          const { key, timestamp, ttl, data } = validationResult.data;
          const size = JSON.stringify(data).length * 2; // UTF-16 approximation
          const expired = !isCacheValid({ data, timestamp, ttl });
          entries.push({ key, timestamp, size, expired });
        }
        cursor.continue();
      };

      request.onerror = () => {
        const error = request.error;
        reject(error ?? new Error("Cache operation failed"));
      };
    });

    // Sort: expired first, then by oldest timestamp
    entries.sort((a, b) => {
      if (a.expired !== b.expired) {
        return a.expired ? -1 : 1;
      }
      return a.timestamp - b.timestamp;
    });

    // Remove entries until we've freed enough space
    let freedBytes = 0;
    for (const entry of entries) {
      if (freedBytes >= targetBytesToFree) {
        break;
      }

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(entry.key);

        request.onsuccess = () => {
          memoryCache.delete(entry.key);
          resolve();
        };

        request.onerror = () => {
          const error = request.error;
          reject(error ?? new Error("Cache operation failed"));
        };
      });
      freedBytes += entry.size;
    }

    return freedBytes;
  } catch (error) {
    console.warn("Error during cache eviction:", error);
    return 0;
  }
}

/**
 * Cache data with specified TTL (in milliseconds)
 * Writes to memory → IndexedDB
 */
export async function setCachedData(
  endpoint: string,
  params: Record<string, unknown>,
  data: unknown,
  ttl: number,
): Promise<void> {
  const cacheKey = generateCacheKey(endpoint, params);
  const entry: CacheEntry = {
    data,
    timestamp: Date.now(),
    ttl,
  };

  // Store in memory cache (always succeeds)
  memoryCache.set(cacheKey, entry);

  // Store in IndexedDB
  try {
    await setInIndexedDB(cacheKey, entry);
  } catch (error) {
    // If quota exceeded, try to free up space and retry
    const QuotaErrorSchema = z.object({
      name: z.literal("QuotaExceededError"),
    });
    const errorResult = QuotaErrorSchema.safeParse(error);
    if (errorResult.success) {
      console.warn("IndexedDB quota exceeded, attempting cache eviction...");

      const serialized = JSON.stringify(entry);
      const estimatedSize = serialized.length * 2; // UTF-16 approximation
      const freedBytes = await evictOldCacheEntries(estimatedSize * 2); // Free 2x the needed space

      if (freedBytes > 0) {
        console.log(
          `Freed ${(freedBytes / 1024).toFixed(2)} KB from IndexedDB cache`,
        );
        try {
          await setInIndexedDB(cacheKey, entry);
          return;
        } catch (retryError) {
          console.warn("IndexedDB write failed after eviction:", retryError);
        }
      } else {
        console.warn("Could not free enough space for IndexedDB cache entry");
      }
    } else {
      console.warn("IndexedDB cache write error:", error);
    }
    // If persistent storage fails, memory cache still works
  }
}
