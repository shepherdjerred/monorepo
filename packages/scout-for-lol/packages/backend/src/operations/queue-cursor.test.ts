import { describe, expect, test } from "vitest";
import {
  decodeQueueCursor,
  encodeQueueCursor,
  splitOverFetchedPage,
} from "#src/operations/queue-cursor.ts";

describe("queue cursors round-trip a position", () => {
  test("an encoded position decodes to the same instant and id", () => {
    const position = {
      at: new Date("2026-09-14T02:31:00.000Z"),
      id: "notification:NA1_5312279829:channel:420003",
    };

    const decoded = decodeQueueCursor(encodeQueueCursor(position));

    expect(decoded.at.getTime()).toBe(position.at.getTime());
    expect(decoded.id).toBe(position.id);
  });

  test("a malformed token is refused rather than read as the front", () => {
    // Silently restarting from the front would page one forever, which looks
    // exactly like a queue that will not drain.
    for (const token of [
      "",
      "not-a-cursor",
      "2026-09-14T02:31:00.000Z",
      "|id",
    ]) {
      expect(() => decodeQueueCursor(token)).toThrow();
    }
  });

  test("an ambiguous token carrying two separators is refused", () => {
    expect(() => decodeQueueCursor("2026-09-14T02:31:00.000Z|a|b")).toThrow(
      /more than one/u,
    );
  });

  test("an instant without an offset is refused", () => {
    expect(() => decodeQueueCursor("2026-09-14T02:31:00|id")).toThrow();
  });
});

describe("over-fetching turns hasMore into an observation", () => {
  test("a full page with one extra row reports more and drops the extra", () => {
    expect(splitOverFetchedPage([1, 2, 3, 4], 3)).toEqual({
      items: [1, 2, 3],
      hasMore: true,
    });
  });

  test("an exactly-full page reports no more", () => {
    // The case a "page came back full" heuristic gets wrong.
    expect(splitOverFetchedPage([1, 2, 3], 3)).toEqual({
      items: [1, 2, 3],
      hasMore: false,
    });
  });

  test("an empty page reports no more", () => {
    expect(splitOverFetchedPage([], 3)).toEqual({ items: [], hasMore: false });
  });
});
