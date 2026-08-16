import * as Sentry from "@sentry/react";

/**
 * The subset of `Storage` this app uses. Everything that persists goes through
 * this type so a single adapter can make every write survive a hostile storage
 * environment.
 */
export type StringStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function createMemoryStore(): StringStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * `globalThis.localStorage` is not merely maybe-absent: reading the property
 * itself throws a SecurityError in a sandboxed iframe or when a browser is
 * configured to block site data. Probing with a real write also catches Safari
 * private mode, which exposes the object but throws on every `setItem`.
 */
function resolveBackingStore(): StringStore {
  const probeKey = "bsc.storage-probe";
  try {
    const storage = globalThis.localStorage;
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return createMemoryStore();
  }
}

/**
 * Wrap a store so no storage exception can escape into render or startup.
 *
 * Storage stays usable in-session even when the browser refuses to persist:
 * keys whose write threw (quota exceeded is the common case, and it can start
 * happening at any time) are held in an in-memory overlay that reads shadow the
 * backing store with, so a failed write is still visible to this tab. Nothing
 * is silently dropped without a report — the first degradation is reported to
 * Sentry once per session, since a full disk would otherwise emit an event on
 * every keystroke-driven write.
 */
export function createSafeStorage(backing: StringStore): StringStore {
  const overlay = new Map<string, string | null>();
  let reported = false;

  const report = (operation: string, key: string, error: unknown) => {
    if (reported) {
      return;
    }
    reported = true;
    Sentry.captureException(error, {
      level: "warning",
      extra: { operation, key },
      tags: { subsystem: "storage" },
    });
  };

  return {
    getItem: (key) => {
      const shadowed = overlay.get(key);
      if (shadowed !== undefined) {
        return shadowed;
      }
      try {
        return backing.getItem(key);
      } catch (error) {
        report("getItem", key, error);
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        backing.setItem(key, value);
        overlay.delete(key);
      } catch (error) {
        report("setItem", key, error);
        overlay.set(key, value);
      }
    },
    removeItem: (key) => {
      try {
        backing.removeItem(key);
        overlay.delete(key);
      } catch (error) {
        report("removeItem", key, error);
        overlay.set(key, null);
      }
    },
  };
}

/**
 * The app-wide storage handle. Every persistent read/write — migration, the
 * bookmark/watch-status stores, and the TanStack Query persister — goes through
 * it, so blocked or exhausted storage costs persistence, never the app.
 */
export const safeStorage: StringStore = createSafeStorage(
  resolveBackingStore(),
);
