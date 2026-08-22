import { describe, expect, test } from "vitest";
import {
  deepestLeafFrom,
  pathToLeaf,
  siblingsOf,
  versionPosition,
  type TreeNode,
} from "#src/explore/tree.ts";

/** Build a node at a fixed offset so ordering is deterministic. */
function node(id: string, parentId: string | null, minute: number): TreeNode {
  return {
    id,
    parentId,
    createdAt: new Date(Date.UTC(2026, 4, 17, 12, minute, 0)),
  };
}

/**
 * A linear conversation, then an edit of the second question forking a branch:
 *
 *   q1 ── a1 ─┬─ q2  ── a2
 *             └─ q2' ── a2'
 */
const LINEAR = [
  node("q1", null, 0),
  node("a1", "q1", 1),
  node("q2", "a1", 2),
  node("a2", "q2", 3),
];
const FORKED = [...LINEAR, node("q2b", "a1", 4), node("a2b", "q2b", 5)];

describe("explore message tree", () => {
  test("a linear conversation reads back in order", () => {
    const leaf = deepestLeafFrom(LINEAR, null);
    expect(leaf).toBe("a2");
    expect(pathToLeaf(LINEAR, leaf).map((entry) => entry.id)).toEqual([
      "q1",
      "a1",
      "q2",
      "a2",
    ]);
  });

  test("a fork leaves the original branch reachable", () => {
    // Newest-wins, so the freshly created branch is the one you land on.
    expect(deepestLeafFrom(FORKED, null)).toBe("a2b");
    expect(pathToLeaf(FORKED, "a2b").map((entry) => entry.id)).toEqual([
      "q1",
      "a1",
      "q2b",
      "a2b",
    ]);
    // …and the original is still a complete, walkable path.
    expect(pathToLeaf(FORKED, "a2").map((entry) => entry.id)).toEqual([
      "q1",
      "a1",
      "q2",
      "a2",
    ]);
  });

  test("version position counts siblings, not depth", () => {
    expect(versionPosition(FORKED, "q2")).toEqual({ index: 0, count: 2 });
    expect(versionPosition(FORKED, "q2b")).toEqual({ index: 1, count: 2 });
    // A message with no sibling is version 1 of 1, not 0 of 0.
    expect(versionPosition(FORKED, "q1")).toEqual({ index: 0, count: 1 });
  });

  test("switching to an older sibling follows that branch to its own leaf", () => {
    expect(deepestLeafFrom(FORKED, "q2")).toBe("a2");
    expect(deepestLeafFrom(FORKED, "q2b")).toBe("a2b");
  });

  test("siblings page oldest first", () => {
    expect(siblingsOf(FORKED, "q2b").map((entry) => entry.id)).toEqual([
      "q2",
      "q2b",
    ]);
  });

  test("siblings created in the same millisecond keep a stable order", () => {
    // SQLite timestamps are millisecond-resolution, so two versions can tie.
    // Without a tiebreak the arrows would reorder between requests.
    const tied = [
      node("root", null, 0),
      { ...node("b", "root", 1) },
      { ...node("a", "root", 1) },
    ];
    expect(siblingsOf(tied, "a").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("an unknown leaf yields an empty path rather than throwing", () => {
    expect(pathToLeaf(LINEAR, "does-not-exist")).toEqual([]);
    expect(pathToLeaf(LINEAR, null)).toEqual([]);
  });

  test("a cyclic parent pointer terminates instead of hanging", () => {
    const cyclic = [node("x", "y", 0), node("y", "x", 1)];
    expect(pathToLeaf(cyclic, "x").length).toBeLessThanOrEqual(2);
    expect(deepestLeafFrom(cyclic, "x")).not.toBeUndefined();
  });
});
