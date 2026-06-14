import { describe, expect, test } from "bun:test";
import {
  DISCORD_MESSAGE_LIMIT,
  sanitizeDiscordText,
  truncateForDiscord,
} from "./discord-message.ts";

function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
  }
  return length;
}

describe("truncateForDiscord", () => {
  test("returns short content unchanged", () => {
    expect(truncateForDiscord("hello")).toBe("hello");
  });

  test("returns content at exactly the limit unchanged", () => {
    const content = "a".repeat(DISCORD_MESSAGE_LIMIT);
    expect(truncateForDiscord(content)).toBe(content);
  });

  test("truncates content over the limit to within the limit", () => {
    const content = "a".repeat(DISCORD_MESSAGE_LIMIT + 500);
    const result = truncateForDiscord(content);
    expect(codePointLength(result)).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(result.endsWith("… (truncated)")).toBe(true);
  });

  test("preserves a prefix of the original content when truncating", () => {
    const content = `START${"x".repeat(DISCORD_MESSAGE_LIMIT)}`;
    const result = truncateForDiscord(content);
    expect(result.startsWith("START")).toBe(true);
  });

  test("never splits a multi-code-point grapheme", () => {
    // Each family emoji is several code points joined by ZWJ; a naive
    // code-unit/code-point cut would leave a broken cluster.
    const family = "👨‍👩‍👧‍👦";
    const content = family.repeat(50);
    const result = truncateForDiscord(content, 40);
    expect(codePointLength(result)).toBeLessThanOrEqual(40);
    // The kept portion is whole families followed by the indicator, so removing
    // the indicator must leave only complete copies of the family emoji.
    const kept = result.slice(0, result.length - "… (truncated)".length);
    expect(kept.length % family.length).toBe(0);
  });

  test("still respects a limit smaller than the indicator", () => {
    const result = truncateForDiscord("a".repeat(100), 5);
    expect(codePointLength(result)).toBeLessThanOrEqual(5);
  });
});

describe("sanitizeDiscordText", () => {
  test("inserts a zero-width space after each @", () => {
    expect(sanitizeDiscordText("@everyone @here")).toBe("@​everyone @​here");
  });

  test("leaves text without @ unchanged", () => {
    expect(sanitizeDiscordText("plain text")).toBe("plain text");
  });
});
