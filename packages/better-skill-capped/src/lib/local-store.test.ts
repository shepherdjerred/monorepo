import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { StringStore } from "./local-store.ts";
import { createLocalStore } from "./local-store.ts";

const EntrySchema = z.strictObject({ id: z.string() });

function parseEntries(raw: unknown): { id: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((element) => {
    const result = EntrySchema.safeParse(element);
    return result.success ? [result.data] : [];
  });
}

function fakeStorage(
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

function makeStore(storage: StringStore) {
  return createLocalStore({
    key: "test-key",
    parse: parseEntries,
    empty: [],
    storage,
  });
}

describe("createLocalStore", () => {
  test("returns the empty value when the key is absent", () => {
    const store = makeStore(fakeStorage());
    expect(store.getSnapshot()).toEqual([]);
  });

  test("snapshots are referentially stable until the value changes", () => {
    const store = makeStore(
      fakeStorage({ "test-key": JSON.stringify([{ id: "a" }]) }),
    );
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.set([{ id: "b" }]);
    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot()).toEqual([{ id: "b" }]);
  });

  test("corrupt JSON yields the empty value without writing back", () => {
    const storage = fakeStorage({ "test-key": "{corrupt" });
    const store = makeStore(storage);
    expect(store.getSnapshot()).toEqual([]);
    // Read path never writes: the corrupt raw data must survive untouched.
    expect(storage.dump()["test-key"]).toBe("{corrupt");
  });

  test("salvages valid elements from partially corrupt data in memory only", () => {
    const storage = fakeStorage({
      "test-key": JSON.stringify([{ id: "a" }, { bogus: 1 }]),
    });
    const store = makeStore(storage);
    expect(store.getSnapshot()).toEqual([{ id: "a" }]);
    expect(storage.dump()["test-key"]).toBe(
      JSON.stringify([{ id: "a" }, { bogus: 1 }]),
    );
  });

  test("set persists and notifies local subscribers", () => {
    const storage = fakeStorage();
    const store = makeStore(storage);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    store.set([{ id: "a" }]);
    expect(notified).toBe(1);
    expect(storage.dump()["test-key"]).toBe(JSON.stringify([{ id: "a" }]));

    unsubscribe();
    store.set([{ id: "b" }]);
    expect(notified).toBe(1);
  });

  test("update composes read-modify-write", () => {
    const store = makeStore(
      fakeStorage({ "test-key": JSON.stringify([{ id: "a" }]) }),
    );
    store.update((current) => [...current, { id: "b" }]);
    expect(store.getSnapshot()).toEqual([{ id: "a" }, { id: "b" }]);
  });
});
