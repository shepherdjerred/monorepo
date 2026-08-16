/**
 * A minimal localStorage-backed external store for useSyncExternalStore.
 *
 * - Snapshots are cached on the raw string, so `getSnapshot` is referentially
 *   stable until the underlying value actually changes.
 * - The read path never writes: corrupt data yields `parse`'s fallback in
 *   memory only, so a transient parse issue can never destroy stored data.
 * - Cross-tab sync comes from the window `storage` event.
 * - Storage itself is reached through `safeStorage`, so a blocked or full
 *   localStorage degrades to in-memory state instead of throwing during render.
 */

import { safeStorage, type StringStore } from "./safe-storage.ts";

export type LocalStore<T> = {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  set: (value: T) => void;
  update: (updater: (current: T) => T) => void;
};

export function createLocalStore<T>(options: {
  key: string;
  /** Parse the JSON-decoded raw value; must handle malformed input itself. */
  parse: (raw: unknown) => T;
  /** Value used when the key is absent or the stored JSON does not decode. */
  empty: T;
  storage?: StringStore;
}): LocalStore<T> {
  const { key, parse, empty } = options;
  const storage = options.storage ?? safeStorage;
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cachedValue: T = empty;

  const getSnapshot = (): T => {
    const raw = storage.getItem(key);
    if (raw === cachedRaw) {
      return cachedValue;
    }
    cachedRaw = raw;
    if (raw === null) {
      cachedValue = empty;
      return cachedValue;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      cachedValue = empty;
      return cachedValue;
    }
    cachedValue = parse(decoded);
    return cachedValue;
  };

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const set = (value: T) => {
    storage.setItem(key, JSON.stringify(value));
    cachedRaw = undefined;
    notify();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        cachedRaw = undefined;
        listener();
      }
    };
    const hasWindow = typeof window !== "undefined";
    if (hasWindow) {
      globalThis.addEventListener("storage", onStorage);
    }
    return () => {
      listeners.delete(listener);
      if (hasWindow) {
        globalThis.removeEventListener("storage", onStorage);
      }
    };
  };

  return {
    getSnapshot,
    subscribe,
    set,
    update: (updater) => {
      set(updater(getSnapshot()));
    },
  };
}
