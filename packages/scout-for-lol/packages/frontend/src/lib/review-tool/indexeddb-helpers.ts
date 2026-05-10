import { z } from "zod";

type UpgradeHandler = (db: IDBDatabase) => void;

/**
 * Open an IndexedDB database with optional upgrade handler
 */
export function openIndexedDB(
  dbName: string,
  version: number,
  upgradeHandler?: UpgradeHandler,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);

    request.onerror = () => {
      const error = request.error;
      reject(error ?? new Error("IndexedDB operation failed"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    if (upgradeHandler) {
      request.onupgradeneeded = (event) => {
        const IDBOpenDBRequestSchema = z.instanceof(IDBOpenDBRequest);
        const targetResult = IDBOpenDBRequestSchema.safeParse(event.target);
        if (targetResult.success) {
          const db = targetResult.data.result;
          upgradeHandler(db);
        }
      };
    }
  });
}

/**
 * Execute an IndexedDB request and return the result
 * Resolves with the result or undefined if no result is available
 */
export function executeRequest<T = IDBValidKey>(
  request: IDBRequest<T>,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      const error = request.error;
      reject(error ?? new Error("IndexedDB operation failed"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

/**
 * Get an object store from a transaction
 */
export function getStore(
  transaction: IDBTransaction,
  storeName: string,
): IDBObjectStore {
  return transaction.objectStore(storeName);
}
