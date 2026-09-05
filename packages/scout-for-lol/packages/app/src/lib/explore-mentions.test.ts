import { describe, expect, test } from "vitest";
import {
  activeMentionSpan,
  applyMention,
  mergeMentionCandidates,
  staticMentionCandidates,
} from "#src/lib/explore-mentions.ts";
import { ExploreMentionCandidateSchema } from "@scout-for-lol/data";

function candidate(overrides: Record<string, unknown>) {
  return ExploreMentionCandidateSchema.parse({
    kind: "player",
    label: "Jerred",
    insertText: "Jerred#NA1",
    ...overrides,
  });
}

describe("activeMentionSpan", () => {
  test("opens on an @ at a word boundary", () => {
    expect(activeMentionSpan("how does @jer", 13)).toEqual({
      query: "jer",
      start: 9,
      end: 13,
    });
    expect(activeMentionSpan("@jer", 4)?.query).toBe("jer");
  });

  test("does not open mid-word", () => {
    // Otherwise a hand-typed Riot ID or an email turns the composer into a
    // popover halfway through being written.
    expect(activeMentionSpan("mail me at bob@example", 22)).toBeNull();
  });

  test("a space closes it", () => {
    // Names contain spaces, but allowing them would leave every `@` open for
    // the rest of the message with no way to dismiss it by typing on.
    expect(activeMentionSpan("how does @jer do", 16)).toBeNull();
  });

  test("only looks behind the caret", () => {
    expect(activeMentionSpan("how does @jerred", 4)).toBeNull();
  });

  test("gives up on an implausibly long token", () => {
    expect(activeMentionSpan(`@${"x".repeat(200)}`, 201)).toBeNull();
  });
});

describe("staticMentionCandidates", () => {
  test("matches champions and queues without a network call", () => {
    const champions = staticMentionCandidates("yas");
    expect(champions.some((item) => item.label === "Yasuo")).toBe(true);
    expect(champions.every((item) => item.kind === "champion")).toBe(true);

    const queues = staticMentionCandidates("flex");
    expect(queues.some((item) => item.label === "flex")).toBe(true);
  });

  test("an empty query offers nothing", () => {
    expect(staticMentionCandidates("   ")).toEqual([]);
  });
});

describe("mergeMentionCandidates", () => {
  test("players rank above the static catalogs", () => {
    // Players are the ambiguous ones — the whole reason to pick rather than
    // type — while a champion name typed by hand already resolves at compile
    // time with a did-you-mean.
    const merged = mergeMentionCandidates(
      [candidate({})],
      [candidate({ kind: "champion", label: "Jhin", insertText: "Jhin" })],
      8,
    );
    expect(merged.map((item) => item.kind)).toEqual(["player", "champion"]);
  });

  test("deduplicates and respects the limit", () => {
    const merged = mergeMentionCandidates(
      [candidate({}), candidate({})],
      [],
      8,
    );
    expect(merged).toHaveLength(1);

    expect(
      mergeMentionCandidates(
        [
          candidate({ insertText: "A#NA1" }),
          candidate({ insertText: "B#NA1" }),
          candidate({ insertText: "C#NA1" }),
        ],
        [],
        2,
      ),
    ).toHaveLength(2);
  });
});

describe("applyMention", () => {
  test("replaces the whole token including the @", () => {
    // The `@` was a trigger for the picker, not part of the question: leaving
    // it in hands the model a token it has to strip before resolving anything.
    const span = activeMentionSpan("how does @jer", 13);
    if (span === null) throw new Error("expected a span");
    expect(applyMention("how does @jer", span, "Jerred#NA1")).toEqual({
      text: "how does Jerred#NA1 ",
      caret: 20,
    });
  });

  test("keeps text after the caret without doubling the space", () => {
    const text = "how does @jer do on Yasuo";
    const span = activeMentionSpan(text, 13);
    if (span === null) throw new Error("expected a span");
    expect(applyMention(text, span, "Jerred#NA1").text).toBe(
      "how does Jerred#NA1 do on Yasuo",
    );
  });
});

describe("editing an existing mention", () => {
  test("the span covers the whole token, not just what is behind the caret", () => {
    // Caret inside `@jerred`, between "jer" and "red". Ending the span at the
    // caret left the suffix behind, so picking a suggestion produced
    // "Jerred#NA1 red" and the question carried a word nobody wrote.
    const text = "how does @jerred do";
    const span = activeMentionSpan(text, 13);
    if (span === null) throw new Error("expected a span");
    expect(span.query).toBe("jer");
    expect(text.slice(span.start, span.end)).toBe("@jerred");
    expect(applyMention(text, span, "Jerred#NA1").text).toBe(
      "how does Jerred#NA1 do",
    );
  });

  test("a caret at the end of a token behaves as before", () => {
    const text = "how does @jer";
    const span = activeMentionSpan(text, 13);
    if (span === null) throw new Error("expected a span");
    expect(span.end).toBe(13);
  });
});
