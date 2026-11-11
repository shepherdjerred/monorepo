import { describe, expect, test } from "vitest";
import { createDrafts } from "./drafts.ts";
import { createListRestore } from "./list-restore.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("drafts", () => {
  test("a draft persists until it is cleared", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    expect(drafts.dirty()).toBe(false);
    drafts.write("comment:AI-1", { text: "Half a thought", attachments: [] });
    // A second store over the same storage is a reload of the tab.
    const reloaded = createDrafts(() => storage);
    expect(reloaded.read("comment:AI-1")).toEqual({
      text: "Half a thought",
      attachments: [],
    });
    expect(reloaded.dirty()).toBe(true);
    reloaded.clear("comment:AI-1");
    expect(drafts.read("comment:AI-1")).toBeUndefined();
    expect(drafts.dirty()).toBe(false);
  });

  test("text equal to what the form started with is not a draft", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    drafts.write(
      "description:AI-1",
      { text: "Edited", attachments: [] },
      "Was",
    );
    expect(drafts.dirty()).toBe(true);
    drafts.write("description:AI-1", { text: "Was", attachments: [] }, "Was");
    expect(drafts.dirty()).toBe(false);
    // An uploaded file is unsent work even when the text is back to the start.
    drafts.write(
      "description:AI-1",
      { text: "Was", attachments: ["a"] },
      "Was",
    );
    expect(drafts.dirty()).toBe(true);
  });

  test("other keys in the same storage are not drafts", () => {
    const storage = memoryStorage();
    storage.setItem("tracker.tab", "abc");
    expect(createDrafts(() => storage).dirty()).toBe(false);
  });
});

describe("list restore", () => {
  test("a list's shape is kept per history entry, oldest entries dropped", () => {
    const storage = memoryStorage();
    const restore = createListRestore(() => storage);
    for (let entry = 0; entry < 32; entry += 1) {
      restore.save(`key-${String(entry)}`, {
        url: "/issues",
        offset: 7200,
        pages: 3,
        size: 14_400,
        sizes: [48, 48, 64],
      });
    }
    expect(restore.read("key-0", "/issues")).toBeUndefined();
    expect(restore.read("key-1", "/issues")).toBeUndefined();
    // The first entry of a tab reuses its key for whatever address is loaded.
    expect(restore.read("key-2", "/issues?state=Todo")).toBeUndefined();
    expect(restore.read("key-2", "/issues")).toEqual({
      url: "/issues",
      offset: 7200,
      pages: 3,
      size: 14_400,
      sizes: [48, 48, 64],
    });
    // Saving an entry again keeps one copy and makes it the newest.
    const shape = { url: "/issues", offset: 0, sizes: [] };
    restore.save("key-2", { ...shape, pages: 4, size: 19_200 });
    restore.save("key-32", { ...shape, pages: 1, size: 4800 });
    expect(restore.read("key-2", "/issues")?.pages).toBe(4);
    expect(restore.read("key-3", "/issues")).toBeUndefined();
    restore.forget("key-2");
    expect(restore.read("key-2", "/issues")).toBeUndefined();
  });
});
