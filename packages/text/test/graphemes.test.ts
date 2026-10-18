import { describe, expect, test } from "vitest";
import {
  chunkGraphemes,
  firstGraphemes,
  graphemePrefix,
  truncateGraphemes,
} from "@shepherdjerred/text";

const GRINNING = "😀"; // one surrogate pair
const FLAG = "🇯🇵"; // two regional indicators
const FAMILY = "👨‍👩‍👧‍👦"; // ZWJ sequence, 11 code units
const THUMBS = "👍🏽"; // emoji + skin-tone modifier
const CODER = "👩‍💻"; // ZWJ sequence, 5 code units

describe("graphemePrefix", () => {
  test.each([
    {
      name: "surrogate pair across the cut",
      text: `${"a".repeat(49)}${GRINNING}b`,
      expected: "a".repeat(49),
    },
    {
      name: "flag across the cut",
      text: `${"a".repeat(49)}${FLAG}`,
      expected: "a".repeat(49),
    },
    {
      name: "ZWJ sequence across the cut",
      text: `${"a".repeat(45)}${FAMILY}`,
      expected: "a".repeat(45),
    },
    {
      name: "modifier across the cut",
      text: `${"a".repeat(48)}${THUMBS}`,
      expected: "a".repeat(48),
    },
    {
      name: "cluster ending exactly at the cut",
      text: `${"a".repeat(48)}${GRINNING}b`,
      expected: `${"a".repeat(48)}${GRINNING}`,
    },
  ])("$name", ({ text, expected }) => {
    const prefix = graphemePrefix(text, 50);
    expect(prefix).toBe(expected);
    expect(prefix.isWellFormed()).toBe(true);
  });

  test("returns short text unchanged", () => {
    expect(graphemePrefix("日本語", 50)).toBe("日本語");
  });

  test("rejects a non-integer budget", () => {
    expect(() => graphemePrefix("abc", 1.5)).toThrow(RangeError);
  });
});

describe("truncateGraphemes", () => {
  test("leaves fitting text untouched without an indicator", () => {
    expect(truncateGraphemes("a".repeat(50), 50)).toBe("a".repeat(50));
  });

  test("keeps the indicator inside the budget", () => {
    const result = truncateGraphemes("a".repeat(60), 50);
    expect(result).toBe(`${"a".repeat(49)}…`);
    expect(result.length).toBe(50);
  });

  test("supports a multi-unit indicator", () => {
    expect(truncateGraphemes("abcdefghij", 6, "...")).toBe("abc...");
  });

  test("never splits a surrogate pair before the indicator", () => {
    const result = truncateGraphemes(
      `${"a".repeat(48)}${GRINNING}${"b".repeat(5)}`,
      50,
    );
    expect(result).toBe(`${"a".repeat(48)}…`);
    expect(result.isWellFormed()).toBe(true);
  });

  test("keeps every emoji whole in an emoji-only string", () => {
    const result = truncateGraphemes(FAMILY.repeat(10), 50);
    expect(result).toBe(`${FAMILY.repeat(4)}…`);
  });

  test("rejects an indicator larger than the budget", () => {
    expect(() => truncateGraphemes("abcdef", 2, "...")).toThrow(RangeError);
  });
});

describe("firstGraphemes", () => {
  test.each([
    { text: "alice", count: 1, expected: "a" },
    { text: `${GRINNING}gamer`, count: 1, expected: GRINNING },
    { text: `${FLAG}${FAMILY}x`, count: 2, expected: `${FLAG}${FAMILY}` },
    { text: "", count: 2, expected: "" },
    { text: "a", count: 2, expected: "a" },
  ])("first $count of $text", ({ text, count, expected }) => {
    expect(firstGraphemes(text, count)).toBe(expected);
  });
});

describe("chunkGraphemes", () => {
  test("round-trips and keeps every chunk within budget and well formed", () => {
    const text = `${"a".repeat(9)}${GRINNING}${"b".repeat(9)}${CODER}${FLAG}`;
    const chunks = chunkGraphemes(text, 10);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
      expect(chunk.isWellFormed()).toBe(true);
    }
    expect(chunks).toEqual([
      "a".repeat(9),
      `${GRINNING}${"b".repeat(8)}`,
      `b${CODER}${FLAG}`,
    ]);
  });

  test("returns no chunks for empty text", () => {
    expect(chunkGraphemes("", 10)).toEqual([]);
  });

  test("splits an oversized cluster between code points", () => {
    const zalgo = `z${"\u{301}".repeat(25)}`;
    const chunks = chunkGraphemes(`ab${zalgo}`, 10);
    expect(chunks.join("")).toBe(`ab${zalgo}`);
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 10, 8]);
    const familyChunks = chunkGraphemes(FAMILY, 5);
    expect(familyChunks.join("")).toBe(FAMILY);
    for (const chunk of familyChunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
      expect(chunk.isWellFormed()).toBe(true);
    }
  });
});
