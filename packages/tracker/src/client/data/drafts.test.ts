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

/** A request the page unloads under: its answer never comes. */
const neverAnswered = () => Promise.withResolvers<{ ok: true }>().promise;

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

  const mark = { kind: "comment", subject: "AI-1" } as const;

  test("a sent draft is no longer a draft before the server answers", async () => {
    const storage = memoryStorage();
    const drafts = createDrafts(
      () => storage,
      () => 1000,
    );
    const draft = { text: "Posted once", attachments: ["file-1"] };
    drafts.write("comment:AI-1", draft);
    const answer = Promise.withResolvers<{ ok: true }>();
    const sending = drafts.send("comment:AI-1", draft, {
      baseline: "",
      mark,
      run: () => answer.promise,
    });
    // A reload now finds no draft to offer, only a send awaiting its answer.
    expect(drafts.read("comment:AI-1")).toBeUndefined();
    expect(drafts.dirty()).toBe(false);
    expect(drafts.pending("comment:AI-1")).toEqual({
      ...mark,
      ...draft,
      sentAt: 1000,
    });
    answer.resolve({ ok: true });
    expect(await sending).toEqual({ outcome: { ok: true }, fate: "saved" });
    expect(drafts.read("comment:AI-1")).toBeUndefined();
    expect(drafts.pending("comment:AI-1")).toBeUndefined();
  });

  test("a refused send puts the draft back exactly", async () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    const draft = { text: "Not posted", attachments: ["file-1"] };
    drafts.write("comment:AI-1", draft);
    const sent = await drafts.send("comment:AI-1", draft, {
      baseline: "",
      mark,
      run: async () => {
        expect(drafts.read("comment:AI-1")).toBeUndefined();
        // The server answered, and said no.
        return {
          ok: false,
          error: Object.assign(new Error("Tracker writes are paused"), {
            data: { code: "FORBIDDEN" },
          }),
        };
      },
    });
    expect(sent.fate).toBe("refused");
    expect(drafts.read("comment:AI-1")).toEqual(draft);
    expect(drafts.pending("comment:AI-1")).toBeUndefined();
    expect(drafts.dirty()).toBe(true);
  });

  test("a send that got no answer stays pending, not a draft", async () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    const draft = { text: "Maybe posted", attachments: [] };
    drafts.write("comment:AI-1", draft);
    const sent = await drafts.send("comment:AI-1", draft, {
      baseline: "",
      mark,
      // The page unloaded under the request, or the connection dropped.
      run: async () => ({ ok: false, error: new TypeError("Failed to fetch") }),
    });
    expect(sent.fate).toBe("unknown");
    expect(drafts.read("comment:AI-1")).toBeUndefined();
    expect(drafts.pending("comment:AI-1")?.text).toBe("Maybe posted");
    // Pending text is not unsaved work the browser should warn about.
    expect(drafts.dirty()).toBe(false);
  });

  test("a pending send is dropped when saved and made a draft again when not", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    const draft = { text: "Maybe posted", attachments: ["file-1"] };
    const leave = () => {
      void drafts.send("comment:AI-1", draft, {
        baseline: "",
        mark,
        run: () => neverAnswered(),
      });
    };
    leave();
    expect(drafts.settle("comment:AI-1", "drop")).toBeUndefined();
    expect(drafts.pending("comment:AI-1")).toBeUndefined();
    expect(drafts.read("comment:AI-1")).toBeUndefined();

    leave();
    expect(drafts.settle("comment:AI-1", "restore")).toEqual(draft);
    expect(drafts.pending("comment:AI-1")).toBeUndefined();
    expect(drafts.read("comment:AI-1")).toEqual(draft);
  });

  test("sending nothing new leaves nothing pending", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    void drafts.send(
      "new-issue.description",
      { text: "", attachments: [] },
      {
        baseline: "",
        mark: { kind: "new-issue-description", subject: "A title" },
        run: () => neverAnswered(),
      },
    );
    expect(drafts.pending("new-issue.description")).toBeUndefined();
  });

  test("the request carrying a pending send is recorded on it, once", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(() => storage);
    void drafts.send(
      "comment:AI-1",
      { text: "Maybe posted", attachments: [] },
      {
        baseline: "",
        mark,
        run: () => neverAnswered(),
      },
    );
    drafts.stamp(
      [{ path: "comments.create", input: { identifier: "AI-2", body: "x" } }],
      "request-other",
    );
    expect(drafts.pending("comment:AI-1")?.requestId).toBeUndefined();
    const call = {
      path: "comments.create",
      input: { identifier: "AI-1", body: "Maybe posted", attachmentIds: [] },
    };
    drafts.stamp(
      [{ path: "meta.bootstrap", input: undefined }, call],
      "request-1",
    );
    drafts.stamp([call], "request-2");
    expect(drafts.pending("comment:AI-1")?.requestId).toBe("request-1");
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
