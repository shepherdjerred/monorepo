/**
 * IndexedDB wrapper for storing history entries with large images
 * IndexedDB can handle much larger data than localStorage (hundreds of MB vs 5-10MB)
 */
import { z } from "zod";
import {
  openIndexedDB,
  executeRequest,
  getStore,
} from "./indexeddb-helpers.ts";

const DB_NAME = "scout-review-history";
const DB_VERSION = 1;
const STORE_NAME = "history";

const DBHistoryEntrySchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  result: z.object({
    text: z.string(),
    image: z.string().optional(),
    metadata: z.unknown(),
    error: z.string().optional(),
  }),
  configSnapshot: z.object({
    model: z.string().optional(),
    personality: z.string().optional(),
    artStyle: z.string().optional(),
  }),
  status: z.enum(["pending", "complete", "error"]),
  rating: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional(),
  notes: z.string().optional(),
});

// Infer type from schema to ensure compatibility with exactOptionalPropertyTypes
export type DBHistoryEntry = z.infer<typeof DBHistoryEntrySchema>;

/**
 * Open IndexedDB connection
 */
async function openDB(): Promise<IDBDatabase> {
  return openIndexedDB(DB_NAME, DB_VERSION, (db) => {
    // Create object store if it doesn't exist
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      objectStore.createIndex("timestamp", "timestamp", { unique: false });
      objectStore.createIndex("status", "status", { unique: false });
    }
  });
}

/**
 * Save a history entry to IndexedDB
 */
export async function saveEntry(entry: DBHistoryEntry): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = getStore(transaction, STORE_NAME);
  const request = store.put(entry);
  await executeRequest(request);
}

/**
 * Get all history entries, sorted by timestamp (newest first)
 */
export async function getAllEntries(): Promise<DBHistoryEntry[]> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readonly");
  const store = getStore(transaction, STORE_NAME);
  const request = store.getAll();
  const result = await executeRequest<unknown[]>(request);
  // executeRequest returns T | void, so result can be undefined
  if (!Array.isArray(result)) {
    return [];
  }
  const entriesResult = z.array(DBHistoryEntrySchema).safeParse(result);
  if (entriesResult.success) {
    const entries = entriesResult.data;
    // Sort by timestamp, newest first
    entries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return entries;
  }
  return [];
}

/**
 * Get a specific entry by ID
 */
export async function getEntry(
  id: string,
): Promise<DBHistoryEntry | undefined> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readonly");
  const store = getStore(transaction, STORE_NAME);
  const request = store.get(id);
  const result = await executeRequest<unknown>(request);
  if (result === undefined || result === null) {
    return undefined;
  }
  const entryResult = DBHistoryEntrySchema.safeParse(result);
  return entryResult.success ? entryResult.data : undefined;
}

/**
 * Delete a specific entry
 */
export async function deleteEntry(id: string): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = getStore(transaction, STORE_NAME);
  const request = store.delete(id);
  await executeRequest(request);
}

/**
 * Clear all entries
 */
export async function clearAllEntries(): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = getStore(transaction, STORE_NAME);
  const request = store.clear();
  await executeRequest(request);
}

/**
 * Get count of entries
 */
export async function getEntryCount(): Promise<number> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readonly");
  const store = getStore(transaction, STORE_NAME);
  const request = store.count();
  const result = await executeRequest<number>(request);
  return result ?? 0;
}

/**
 * Delete old entries to maintain a maximum count
 */
export async function trimToMaxEntries(maxCount: number): Promise<void> {
  const entries = await getAllEntries();
  if (entries.length <= maxCount) {
    return;
  }

  const toDelete = entries.slice(maxCount);
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = getStore(transaction, STORE_NAME);

  await Promise.all(
    toDelete.map((entry) => {
      const request = store.delete(entry.id);
      return executeRequest(request);
    }),
  );
}
