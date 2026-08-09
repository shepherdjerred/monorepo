import { describe, expect, test } from "bun:test";
import {
  decideReactionAward,
  decodeLeaderboardButtonId,
  decodeModalId,
  emojiMatchesKarma,
  encodeLeaderboardButtonId,
  encodeModalId,
  shouldResolveReactionAdd,
} from "./rules.ts";
import { parseLeaderboardKind } from "./leaderboard-kinds.ts";

describe("parseLeaderboardKind", () => {
  test.each(["received", "given"])("accepts %s", (kind) => {
    expect(parseLeaderboardKind(kind)).toBe(kind);
  });

  test.each(["", "generous", "RECEIVED"])("rejects %p", (kind) => {
    expect(parseLeaderboardKind(kind)).toBeNull();
  });
});

describe("leaderboard button id round-trip", () => {
  test("carries the whole view through the custom id", () => {
    // Buttons hold no other state, so kind, period, and page must survive.
    const id = encodeLeaderboardButtonId({
      kind: "given",
      period: "month",
      page: 2,
    });
    expect(decodeLeaderboardButtonId(id)).toEqual({
      kind: "given",
      period: "month",
      page: 2,
    });
  });

  test.each([
    ["karma-lb:received:all", "missing the page"],
    ["karma-give:1:2:3", "a different component's id"],
    ["karma-lb:received:all:-1", "a negative page"],
    ["karma-lb:received:all:abc", "a non-numeric page"],
    ["karma-lb::all:0", "an empty kind"],
    ["karma-lb:received::0", "an empty period"],
  ])("rejects %s (%s)", (customId) => {
    expect(decodeLeaderboardButtonId(customId)).toBeNull();
  });
});

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

describe("shouldResolveReactionAdd", () => {
  test("resolves a human's configured karma reaction", () => {
    expect(
      shouldResolveReactionAdd({
        emoji: { name: "⭐", id: null },
        configuredEmoji: "⭐",
        reactorIsBot: false,
      }),
    ).toBe(true);
  });

  test("rejects a different emoji before a partial fetch", () => {
    expect(
      shouldResolveReactionAdd({
        emoji: { name: "🔥", id: null },
        configuredEmoji: "⭐",
        reactorIsBot: false,
      }),
    ).toBe(false);
  });

  test("rejects a bot reactor before a partial fetch", () => {
    expect(
      shouldResolveReactionAdd({
        emoji: { name: "⭐", id: null },
        configuredEmoji: "⭐",
        reactorIsBot: true,
      }),
    ).toBe(false);
  });
});

describe("decideReactionAward", () => {
  const base = {
    emojiMatches: true,
    guildId: "guild",
    reactorId: "reactor",
    reactorIsBot: false,
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
    [{ reactorIsBot: true }, "reactor is a bot"],
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
