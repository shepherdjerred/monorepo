import { describe, expect, test } from "bun:test";
import { assertDiscordPageOrder } from "./glitter-corpus-page-order.ts";

describe("Discord corpus page ordering", () => {
  test("accepts Discord's direction-specific page order", () => {
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2", "1"],
        direction: "backward",
        objectKey: "backward.json",
      }),
    ).not.toThrow();
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["1", "2", "3"],
        direction: "forward",
        objectKey: "forward.json",
      }),
    ).not.toThrow();
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2", "1"],
        direction: "daily-overlap",
        objectKey: "overlap.json",
      }),
    ).not.toThrow();
  });

  test("rejects reversed and duplicate IDs", () => {
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2"],
        direction: "forward",
        objectKey: "reversed.json",
      }),
    ).toThrow("oldest-to-newest");
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["2", "2"],
        direction: "backward",
        objectKey: "duplicate.json",
      }),
    ).toThrow("newest-to-oldest");
  });
});
