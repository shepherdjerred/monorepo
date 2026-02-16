/**
 * Unified IndexedDB storage utility for all persistent data
 * Replaces localStorage with a more robust and capable storage solution
 */
import { z } from "zod";
import {
  openIndexedDB,
  executeRequest,
  getStore,
} from "./indexeddb-helpers.ts";

const DB_NAME = "scout-review-storage";
const DB_VERSION = 1;

// Object store names
export const STORES = {
  CONFIGS: "configs",
  CURRENT_CONFIG: "current-config",
  GLOBAL_CONFIG: "global-config",
  PERSONALITIES: "personalities",
  ART_STYLES: "art-styles",
  COSTS: "costs",
  PREFERENCES: "preferences",
} as const;

/**
 * IndexedDB connection (lazy initialized)
 */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB connection with all required object stores
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = openIndexedDB(DB_NAME, DB_VERSION, (db) => {
    // Create all object stores if they don't exist
    if (!db.objectStoreNames.contains(STORES.CONFIGS)) {
      db.createObjectStore(STORES.CONFIGS, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(STORES.CURRENT_CONFIG)) {
      db.createObjectStore(STORES.CURRENT_CONFIG);
    }
    if (!db.objectStoreNames.contains(STORES.GLOBAL_CONFIG)) {
      db.createObjectStore(STORES.GLOBAL_CONFIG);
    }
    if (!db.objectStoreNames.contains(STORES.PERSONALITIES)) {
      db.createObjectStore(STORES.PERSONALITIES, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(STORES.ART_STYLES)) {
      db.createObjectStore(STORES.ART_STYLES, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(STORES.COSTS)) {
      db.createObjectStore(STORES.COSTS);
    }
    if (!db.objectStoreNames.contains(STORES.PREFERENCES)) {
      db.createObjectStore(STORES.PREFERENCES);
    }
  });

  return dbPromise;
}

/**
 * Get a single value from a store.
 *
 * Returns `unknown` to enforce runtime validation by callers.
 * All callers should validate the result with Zod before using it.
 */
export async function getItem(
  storeName: string,
  key: string,
): Promise<unknown> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readonly");
    const store = getStore(transaction, storeName);
    const request = store.get(key);
    const result = await executeRequest<unknown>(request);
    if (result === undefined || result === null) {
      return null;
    }
    return result;
  } catch (error) {
    console.warn(`Failed to get item from ${storeName}:`, error);
    return null;
  }
}

/**
 * Set a single value in a store
 */
export async function setItem(
  storeName: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readwrite");
    const store = getStore(transaction, storeName);
    const request = store.put(value, key);
    await executeRequest(request);
    return true;
  } catch (error) {
    console.warn(`Failed to set item in ${storeName}:`, error);
    return false;
  }
}

/**
 * Get all values from a store (for stores with keyPath)
 */
export async function getAllItems(storeName: string): Promise<unknown[]> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readonly");
    const store = getStore(transaction, storeName);
    const request = store.getAll();
    const result = await executeRequest<unknown[]>(request);
    // Validate with Zod to ensure it's an array
    const ArraySchema = z.array(z.unknown());
    const parsed = ArraySchema.safeParse(result);
    if (!parsed.success) {
      return [];
    }
    return parsed.data;
  } catch (error) {
    console.warn(`Failed to get all items from ${storeName}:`, error);
    return [];
  }
}

/**
 * Add or update an item in a store with keyPath
 */
export async function putItem(
  storeName: string,
  value: unknown,
): Promise<boolean> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readwrite");
    const store = getStore(transaction, storeName);
    const request = store.put(value);
    await executeRequest(request);
    return true;
  } catch (error) {
    console.warn(`Failed to put item in ${storeName}:`, error);
    return false;
  }
}

/**
 * Delete an item from a store with keyPath
 */
export async function deleteItem(
  storeName: string,
  key: string,
): Promise<boolean> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readwrite");
    const store = getStore(transaction, storeName);
    const request = store.delete(key);
    await executeRequest(request);
    return true;
  } catch (error) {
    console.warn(`Failed to delete item from ${storeName}:`, error);
    return false;
  }
}

/**
 * Clear all items from a store
 */
export async function clearStore(storeName: string): Promise<boolean> {
  try {
    const db = await getDB();
    const transaction = db.transaction([storeName], "readwrite");
    const store = getStore(transaction, storeName);
    const request = store.clear();
    await executeRequest(request);
    return true;
  } catch (error) {
    console.warn(`Failed to clear store ${storeName}:`, error);
    return false;
  }
}

/**
 * Migrate a single item from localStorage to IndexedDB
 */
async function migrateSingleItem(
  localStorageKey: string,
  store: string,
  isArray?: boolean,
  key?: string,
): Promise<void> {
  const stored = localStorage.getItem(localStorageKey);
  if (!stored) {
    return;
  }

  const parsed = JSON.parse(stored);

  if (isArray) {
    // For array data, store each item individually
    const ArraySchema = z.array(z.unknown());
    const result = ArraySchema.safeParse(parsed);
    if (result.success) {
      for (const item of result.data) {
        await putItem(store, item);
      }
    }
  } else if (key) {
    // For single value data, store with specified key
    await setItem(store, key, parsed);
  }

  // Remove from localStorage after successful migration
  localStorage.removeItem(localStorageKey);
  console.log(`Migrated ${localStorageKey} to IndexedDB`);
}

/**
 * Migrate data from localStorage to IndexedDB
 * This should be called once on app startup
 */
export async function migrateFromLocalStorage(): Promise<void> {
  const migrations = [
    {
      localStorageKey: "review-dev-tool-configs",
      store: STORES.CONFIGS,
      isArray: true,
    },
    {
      localStorageKey: "review-dev-tool-current",
      store: STORES.CURRENT_CONFIG,
      key: "current",
    },
    {
      localStorageKey: "review-dev-tool-global-config",
      store: STORES.GLOBAL_CONFIG,
      key: "global",
    },
    {
      localStorageKey: "review-dev-tool-custom-personalities",
      store: STORES.PERSONALITIES,
      isArray: true,
    },
    {
      localStorageKey: "review-dev-tool-custom-art-styles",
      store: STORES.ART_STYLES,
      isArray: true,
    },
    {
      localStorageKey: "scout-review-costs",
      store: STORES.COSTS,
      key: "costs",
    },
    {
      localStorageKey: "darkMode",
      store: STORES.PREFERENCES,
      key: "darkMode",
    },
  ];

  for (const migration of migrations) {
    try {
      await migrateSingleItem(
        migration.localStorageKey,
        migration.store,
        migration.isArray,
        migration.key,
      );
    } catch (error) {
      console.error(`Failed to migrate ${migration.localStorageKey}:`, error);
    }
  }
}
