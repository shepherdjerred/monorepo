import { describe, expect, test } from "vitest";
import type { ThreadView } from "@shepherdjerred/artifacts/procedures";
import { anchorLabel, isOtherVersion, pinsOf } from "./pins.ts";

function thread(
  id: string,
  anchor: ThreadView["anchor"],
  versionNumber: number | null,
): ThreadView {
  return {
    id,
    boardId: "b",
    artifactId: "a",
    versionId: "v",
    versionNumber,
    anchor,
    state: "open",
    createdAt: "2026-11-26T10:00:00.000Z",
    resolvedAt: null,
    comments: [],
  };
}

describe("pinsOf", () => {
  test("skips general and board threads and numbers by position", () => {
    const pins = pinsOf(
      [
        thread("g", { type: "general" }, 1),
        thread("p", { type: "page", page: 2, x: 0.5, y: 0.5 }, 1),
      ],
      1,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ id: "p", index: 2, stale: false });
  });

  test("marks a pin from another version as stale", () => {
    const pins = pinsOf([thread("p", { type: "frame", x: 0.1, y: 0.2 }, 1)], 2);
    expect(pins[0]?.stale).toBe(true);
  });
});

describe("isOtherVersion", () => {
  test("is true only when both versions are known and differ", () => {
    expect(isOtherVersion(1, 2)).toBe(true);
    expect(isOtherVersion(2, 2)).toBe(false);
    expect(isOtherVersion(null, 2)).toBe(false);
    expect(isOtherVersion(1, null)).toBe(false);
  });

  test("a pin is hollow exactly when its thread shows the badge", () => {
    const threads = [thread("p", { type: "frame", x: 0.1, y: 0.2 }, 1)];
    expect(pinsOf(threads, 1)[0]?.stale).toBe(isOtherVersion(1, 1));
    expect(pinsOf(threads, 2)[0]?.stale).toBe(isOtherVersion(1, 2));
  });
});

describe("anchorLabel", () => {
  test("names the place", () => {
    expect(anchorLabel({ type: "page", page: 2, x: 0, y: 0 })).toBe("Page 2");
    expect(anchorLabel({ type: "time", t: 75.4 })).toBe("At 1:15");
    expect(anchorLabel({ type: "general" })).toBe("General");
  });
});
