import { expect, test } from "vitest";
import {
  EMPTY_PAGES_PER_LOOK,
  readPastEmptyPages,
  type CursorPage,
} from "./use-cursor-list.ts";

/**
 * A list as pages keyed by the cursor that reads them. Records every cursor
 * asked for, in order.
 */
function list(pages: Record<string, CursorPage<string>>) {
  const asked: (string | null)[] = [];
  return {
    asked,
    read: (cursor: string | null) => {
      asked.push(cursor);
      const page = pages[cursor ?? "first"];
      if (page === undefined) throw new Error(`No page at ${String(cursor)}`);
      return Promise.resolve(page);
    },
  };
}

test("a first page with something in it is the whole look", async () => {
  const { read, asked } = list({
    first: { items: ["a"], nextCursor: "2" },
    "2": { items: ["b"], nextCursor: null },
  });
  expect(await readPastEmptyPages(read, null)).toEqual({
    items: ["a"],
    nextCursor: "2",
  });
  expect(asked).toEqual([null]);
});

test("a look reads on past empty pages to the first with anything in it", async () => {
  const { read, asked } = list({
    first: { items: [], nextCursor: "2" },
    "2": { items: [], nextCursor: "3" },
    "3": { items: ["a", "b"], nextCursor: "4" },
    "4": { items: ["c"], nextCursor: null },
  });
  // The page it stops on is returned whole, with its own way on.
  expect(await readPastEmptyPages(read, null)).toEqual({
    items: ["a", "b"],
    nextCursor: "4",
  });
  expect(asked).toEqual([null, "2", "3"]);
  // The next look starts where that one stopped.
  expect(await readPastEmptyPages(read, "4")).toEqual({
    items: ["c"],
    nextCursor: null,
  });
});

test("a list that ends on empty pages ends: nothing, and no way on", async () => {
  const { read, asked } = list({
    first: { items: [], nextCursor: "2" },
    "2": { items: [], nextCursor: null },
  });
  expect(await readPastEmptyPages(read, null)).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(asked).toEqual([null, "2"]);
});

test("a look stops after a bounded run of empty pages and keeps its place", async () => {
  // Empty pages without end: page n leads to page n + 1.
  const asked: (string | null)[] = [];
  const read = (cursor: string | null) => {
    asked.push(cursor);
    const next = String(Number(cursor ?? "0") + 1);
    return Promise.resolve({ items: [], nextCursor: next });
  };
  const first = await readPastEmptyPages(read, null);
  expect(asked).toHaveLength(EMPTY_PAGES_PER_LOOK);
  // Nothing found, and more behind it: the caller offers another look.
  expect(first).toEqual({
    items: [],
    nextCursor: String(EMPTY_PAGES_PER_LOOK),
  });
  // Which goes on from there, not from the start.
  await readPastEmptyPages(read, first.nextCursor);
  expect(asked).toHaveLength(EMPTY_PAGES_PER_LOOK * 2);
  expect(asked[EMPTY_PAGES_PER_LOOK]).toBe(String(EMPTY_PAGES_PER_LOOK));
  expect(new Set(asked).size).toBe(asked.length);
});

test("a page that answers with the cursor it was read with is an error, not a loop", async () => {
  const { read, asked } = list({
    first: { items: [], nextCursor: "2" },
    "2": { items: [], nextCursor: "2" },
  });
  await expect(readPastEmptyPages(read, null)).rejects.toThrow(
    "A cursor-paged read answered with its own cursor",
  );
  expect(asked).toEqual([null, "2"]);
});
