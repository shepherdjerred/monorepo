import { describe, expect, test } from "bun:test";
import {
  moveItem,
  removeAt,
  shuffleQueue,
} from "@shepherdjerred/streambot/machine/queue-ops.ts";

describe("removeAt", () => {
  test("removes the 1-based index", () => {
    expect(removeAt(["a", "b", "c"], 2)).toEqual(["a", "c"]);
  });
  test("ignores out-of-range indices", () => {
    expect(removeAt(["a", "b"], 5)).toEqual(["a", "b"]);
    expect(removeAt(["a", "b"], 0)).toEqual(["a", "b"]);
  });
});

describe("moveItem", () => {
  test("moves a 1-based item to a new position", () => {
    expect(moveItem(["a", "b", "c"], 1, 3)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 3, 1)).toEqual(["c", "a", "b"]);
  });
  test("returns a copy unchanged for out-of-range positions", () => {
    expect(moveItem(["a", "b"], 5, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"]);
  });
});

describe("shuffleQueue", () => {
  test("preserves the multiset of items", () => {
    expect(shuffleQueue(["a", "b", "c", "d"]).toSorted()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
