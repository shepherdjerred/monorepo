import { describe, expect, test } from "bun:test";

import { formatDuration, generateId, groupBy, pluralize } from "./utils";

describe("formatDuration", () => {
  test("formats minutes under 60 as 'Nm'", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(1)).toBe("1m");
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(59)).toBe("59m");
  });

  test("formats exact hours without minutes", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(180)).toBe("3h");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(61)).toBe("1h 1m");
    expect(formatDuration(150)).toBe("2h 30m");
  });
});

describe("groupBy", () => {
  test("groups items by the key function", () => {
    const items = [
      { name: "Alice", team: "A" },
      { name: "Bob", team: "B" },
      { name: "Charlie", team: "A" },
    ];
    const result = groupBy(items, (item) => item.team);
    expect(result).toEqual({
      A: [
        { name: "Alice", team: "A" },
        { name: "Charlie", team: "A" },
      ],
      B: [{ name: "Bob", team: "B" }],
    });
  });

  test("returns empty object for empty array", () => {
    expect(groupBy([], () => "key")).toEqual({});
  });

  test("all items in one group", () => {
    const items = [1, 2, 3];
    const result = groupBy(items, () => "all");
    expect(result).toEqual({ all: [1, 2, 3] });
  });

  test("each item in its own group", () => {
    const items = ["a", "b", "c"];
    const result = groupBy(items, (item) => item);
    expect(result).toEqual({ a: ["a"], b: ["b"], c: ["c"] });
  });
});

describe("pluralize", () => {
  test("returns singular form for count 1", () => {
    expect(pluralize(1, "task")).toBe("1 task");
  });

  test("returns plural form with 's' suffix by default", () => {
    expect(pluralize(0, "task")).toBe("0 tasks");
    expect(pluralize(2, "task")).toBe("2 tasks");
    expect(pluralize(100, "task")).toBe("100 tasks");
  });

  test("uses custom plural form when provided", () => {
    expect(pluralize(0, "person", "people")).toBe("0 people");
    expect(pluralize(2, "person", "people")).toBe("2 people");
  });

  test("uses singular form for exactly 1", () => {
    expect(pluralize(1, "person", "people")).toBe("1 person");
  });
});

describe("generateId", () => {
  test("returns a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  test("contains a hyphen separator", () => {
    expect(generateId()).toContain("-");
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
