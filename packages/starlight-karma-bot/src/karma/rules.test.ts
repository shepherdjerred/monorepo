import { describe, expect, test } from "bun:test";
import {
  decideReactionAward,
  decodeModalId,
  emojiMatchesKarma,
  encodeModalId,
} from "./rules.ts";

describe("emojiMatchesKarma", () => {
  test("matches a unicode emoji by name", () => {
    expect(emojiMatchesKarma({ name: "⭐", id: null }, "⭐")).toBe(true);
  });

  test("matches a custom guild emoji by id", () => {
    // Custom emoji carry a snowflake id and an arbitrary name, so configuring
    // the id is the stable way to point at one.
    expect(
      emojiMatchesKarma(
        { name: "karma", id: "123456789012345678" },
        "123456789012345678",
      ),
    ).toBe(true);
  });

  test("does not match a different emoji", () => {
    expect(emojiMatchesKarma({ name: "🔥", id: null }, "⭐")).toBe(false);
  });
});

describe("decideReactionAward", () => {
  const base = {
    emojiMatches: true,
    guildId: "guild",
    reactorId: "reactor",
    authorId: "author",
    authorIsBot: false,
  };

  test("awards to the message author", () => {
    expect(decideReactionAward(base)).toEqual({
      action: "award",
      receiverId: "author",
    });
  });

  test.each([
    [{ emojiMatches: false }, "not the karma emoji"],
    [{ guildId: null }, "not in a guild"],
    [{ authorId: undefined }, "message author is unknown"],
    [{ authorIsBot: true }, "message author is a bot"],
    // Ignored rather than penalized: the slash command deliberately penalizes
    // self-gives, but reacting to your own message is usually expressive and
    // punishing it would make the emoji feel like a trap.
    [{ authorId: "reactor" }, "reacting to your own message"],
  ])("ignores when %o", (override, reason) => {
    expect(decideReactionAward({ ...base, ...override })).toEqual({
      action: "ignore",
      reason,
    });
  });
});

describe("modal id round-trip", () => {
  test("encodes and decodes the target message and author", () => {
    // Discord gives the modal submission no reference back to the message that
    // opened it, so the target has to survive this round-trip.
    const id = encodeModalId("111111111111111111", "222222222222222222");
    expect(decodeModalId(id)).toEqual({
      messageId: "111111111111111111",
      authorId: "222222222222222222",
    });
  });

  test("stays within Discord's 100-character custom id limit", () => {
    expect(
      encodeModalId("111111111111111111", "222222222222222222").length,
    ).toBeLessThanOrEqual(100);
  });

  test.each([
    ["other-modal:1:2", "a different modal's id"],
    ["karma-give:1", "missing the author"],
    ["karma-give:1:2:3", "an extra segment"],
    ["karma-give::2", "an empty message id"],
    ["karma-give:1:", "an empty author id"],
    ["", "an empty string"],
  ])("rejects %s (%s)", (customId) => {
    expect(decodeModalId(customId)).toBeNull();
  });
});
