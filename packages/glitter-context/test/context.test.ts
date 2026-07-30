import { describe, expect, test } from "bun:test";
import {
  currentRelationships,
  getPerson,
  getRelationshipHistory,
  getStyleCard,
  listStyleCardNames,
  people,
  relationshipEvents,
  relationshipContextText,
  styleCardToPromptContext,
} from "#src/index.ts";
import { StyleCardV2Schema } from "#src/schema.ts";

function createV2StyleCard() {
  return {
    schemaVersion: 2,
    author: "Test Person",
    coverage: {
      source_snapshot_sha256: "a".repeat(64),
      corpus: {
        messages: 45,
        date_range: {
          start: "2021-01-01T00:00:00.000Z",
          end: "2026-07-29T00:00:00.000Z",
        },
      },
      evidence: {
        safe_messages: 42,
        summarized_messages: 42,
        chunks: 2,
        direct_recent_messages: 42,
        date_range: {
          start: "2021-01-01T00:00:00.000Z",
          end: "2026-07-29T00:00:00.000Z",
        },
        strategy: "all-safe-monthly-chunks-plus-latest-500",
      },
      notes: "Complete safe evidence.",
    },
    voice: ["direct"],
    style_markers: ["marker"],
    topics: ["topic"],
    relationships: ["relationship"],
    behaviors: ["behavior"],
    personality: ["personality"],
    humor_or_tone: ["tone"],
    quotes: Array.from({ length: 20 }, (_, index) => `quote-${String(index)}`),
    summary: "summary",
    likes_dislikes: ["likes"],
    league: { roles: ["mid"] },
    other_games: ["game"],
    how_to_mimic: ["mimic"],
    sample_messages: Array.from(
      { length: 30 },
      (_, index) => `sample-${String(index)}`,
    ),
    situational_examples: {
      provenance: "synthetic",
      happy_or_excited: ["happy-1", "happy-2", "happy-3"],
      angry_or_frustrated: ["angry-1", "angry-2", "angry-3"],
      sad_or_disappointed: ["sad-1", "sad-2", "sad-3"],
      supportive_or_caring: ["support-1", "support-2", "support-3"],
      playful_or_teasing: ["playful-1", "playful-2", "playful-3"],
      neutral_or_logistical: ["neutral-1", "neutral-2", "neutral-3"],
    },
    concerns: ["human review required"],
  };
}

describe("Glitter context", () => {
  test("loads the canonical 13 style cards and resolves aliases", () => {
    expect(listStyleCardNames()).toEqual([
      "aaron",
      "brian",
      "caitlyn",
      "colin",
      "danny",
      "edward",
      "hirza",
      "irfan",
      "jerred",
      "long",
      "richard",
      "ryan",
      "virmel",
    ]);
    expect(getStyleCard("NekoRyan")?.author).toBe("Ryan");
    expect(getStyleCard("gex")?.author).toBe("Aaron");
  });

  test("keeps relationship history while projecting the current graph", () => {
    const history = getRelationshipHistory("caitlyn", "richard");
    expect(history.map((event) => event.label)).toEqual(["Dating", "Exes"]);
    expect(history.map((event) => event.status)).toEqual([
      "historical",
      "current",
    ]);
    expect(
      currentRelationships.find(
        (event) => event.sourceId === "caitlyn" && event.targetId === "richard",
      )?.label,
    ).toBe("Exes");
    expect(relationshipContextText()).toContain("Caitlyn ↔ Richard (Exes)");
  });

  test("all relationship events reference known people", () => {
    const personIds = new Set(people.map((person) => person.id));
    for (const event of relationshipEvents) {
      expect(personIds.has(event.sourceId)).toBe(true);
      expect(personIds.has(event.targetId)).toBe(true);
    }
    expect(getPerson("NekoRyan")?.id).toBe("ryan");
  });

  test("validates V2 cardinality and projects the complete prompt context", () => {
    const styleCard = StyleCardV2Schema.parse(createV2StyleCard());
    const context = styleCardToPromptContext(styleCard);

    expect(context?.quotes).toHaveLength(20);
    expect(context?.quotes.at(-1)).toBe("quote-19");
    expect(context?.sample_messages).toHaveLength(30);
    expect(context?.sample_messages.at(-1)).toBe("sample-29");
    expect(context?.situational_examples.neutral_or_logistical.at(-1)).toBe(
      "neutral-3",
    );
    expect(context).not.toHaveProperty("schemaVersion");
    expect(context).not.toHaveProperty("coverage");
  });

  test("rejects incomplete V2 evidence collections", () => {
    const styleCard = createV2StyleCard();

    expect(
      StyleCardV2Schema.safeParse({
        ...styleCard,
        quotes: styleCard.quotes.slice(1),
      }).success,
    ).toBe(false);
    expect(
      StyleCardV2Schema.safeParse({
        ...styleCard,
        sample_messages: styleCard.sample_messages.slice(1),
      }).success,
    ).toBe(false);
    expect(
      StyleCardV2Schema.safeParse({
        ...styleCard,
        situational_examples: {
          ...styleCard.situational_examples,
          happy_or_excited: ["happy-1", "happy-2"],
        },
      }).success,
    ).toBe(false);
  });
});
