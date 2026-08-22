import { describe, expect, test } from "vitest";
import type { StringStore } from "./safe-storage.ts";
import { createSafeStorage } from "./safe-storage.ts";

function workingStore(
  initial: Record<string, string> = {},
): StringStore & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

function throwBlocked(): never {
  throw new DOMException("The operation is insecure.", "SecurityError");
}

/** Storage disabled at the browser level: every operation throws. */
function hostileStore(): StringStore {
  return {
    getItem: throwBlocked,
    setItem: throwBlocked,
    removeItem: throwBlocked,
  };
}

/** Safari private mode / a full disk: reads work, writes throw. */
function readOnlyStore(
  initial: Record<string, string> = {},
): StringStore & { dump: () => Record<string, string> } {
  const backing = workingStore(initial);
  return {
    getItem: backing.getItem,
    setItem: () => {
      throw new DOMException("Quota exceeded.", "QuotaExceededError");
    },
    removeItem: () => {
      throw new DOMException("Quota exceeded.", "QuotaExceededError");
    },
    dump: backing.dump,
  };
}

describe("createSafeStorage", () => {
  test("delegates to a working store", () => {
    const backing = workingStore({ a: "1" });
    const storage = createSafeStorage(backing);

    expect(storage.getItem("a")).toBe("1");
    storage.setItem("b", "2");
    expect(backing.dump()).toEqual({ a: "1", b: "2" });
    storage.removeItem("a");
    expect(backing.dump()).toEqual({ b: "2" });
  });

  test("never throws when every storage operation throws", () => {
    const storage = createSafeStorage(hostileStore());

    expect(storage.getItem("a")).toBeNull();
    expect(() => {
      storage.setItem("a", "1");
    }).not.toThrow();
    expect(() => {
      storage.removeItem("a");
    }).not.toThrow();
  });

  test("a failed write stays readable in-session", () => {
    const storage = createSafeStorage(hostileStore());

    storage.setItem("a", "1");
    expect(storage.getItem("a")).toBe("1");
    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
  });

  test("a rejected write shadows the stale persisted value", () => {
    const backing = readOnlyStore({ a: "old" });
    const storage = createSafeStorage(backing);

    expect(storage.getItem("a")).toBe("old");
    storage.setItem("a", "new");
    // The write could not be persisted, but this tab must not keep rendering
    // the value the user just replaced.
    expect(storage.getItem("a")).toBe("new");
    expect(backing.dump()).toEqual({ a: "old" });
  });

  test("a rejected removal shadows the stale persisted value", () => {
    const backing = readOnlyStore({ a: "old" });
    const storage = createSafeStorage(backing);

    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
    expect(backing.dump()).toEqual({ a: "old" });
  });

  test("a later successful write clears the overlay", () => {
    let failing = true;
    const persisted = new Map<string, string>();
    const storage = createSafeStorage({
      getItem: (key) => persisted.get(key) ?? null,
      setItem: (key, value) => {
        if (failing) {
          throw new DOMException("Quota exceeded.", "QuotaExceededError");
        }
        persisted.set(key, value);
      },
      removeItem: (key) => {
        persisted.delete(key);
      },
    });

    storage.setItem("a", "1");
    expect(persisted.has("a")).toBe(false);

    failing = false;
    storage.setItem("a", "2");
    expect(persisted.get("a")).toBe("2");
    expect(storage.getItem("a")).toBe("2");
  });
});
