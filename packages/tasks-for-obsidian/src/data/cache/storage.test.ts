import { describe, expect, test } from "bun:test";

import { makeTask } from "../sync/__tests__/harness";
import { parseTaskCache } from "./storage";

describe("parseTaskCache — per-element salvage", () => {
  test("one corrupt entry does not discard the rest of the cache", () => {
    const good = makeTask();
    const raw = JSON.stringify([
      good,
      { id: 42, title: null }, // corrupt: wrong types
      { ...makeTask({ title: "Second" }), status: "not-a-status" }, // corrupt enum
    ]);
    const tasks = parseTaskCache(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(good.id);
  });

  test("keeps every valid entry", () => {
    const a = makeTask();
    const b = makeTask({ title: "B" });
    const tasks = parseTaskCache(JSON.stringify([a, b]));
    expect(tasks).toHaveLength(2);
  });

  test("null, malformed JSON, and non-arrays yield an empty cache", () => {
    expect(parseTaskCache(null)).toEqual([]);
    expect(parseTaskCache("not json")).toEqual([]);
    expect(parseTaskCache('{"a":1}')).toEqual([]);
  });
});
