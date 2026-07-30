import { describe, expect, test } from "bun:test";
import {
  StyleCardV2Schema,
  StylePromptContextSchema,
} from "@shepherdjerred/glitter-context/schema";
import { serializeStyleCardForScoutPrompt } from "./style-card-prompt.ts";

describe("serializeStyleCardForScoutPrompt", () => {
  test("keeps the complete V2 context and omits operational metadata", () => {
    const styleCard = StyleCardV2Schema.parse({
      schemaVersion: 2,
      author: "Scout Sentinel",
      coverage: {
        source_snapshot_sha256: "a".repeat(64),
        corpus: {
          messages: 100,
          date_range: {
            start: "2024-01-01T00:00:00.000Z",
            end: "2026-01-01T00:00:00.000Z",
          },
        },
        evidence: {
          safe_messages: 50,
          summarized_messages: 50,
          chunks: 2,
          direct_recent_messages: 50,
          date_range: {
            start: "2024-01-01T00:00:00.000Z",
            end: "2026-01-01T00:00:00.000Z",
          },
          strategy: "all-safe-monthly-chunks-plus-latest-500",
        },
        notes: "sentinel",
      },
      voice: ["voice-last"],
      style_markers: ["marker-last"],
      topics: ["topic-last"],
      relationships: ["relationship-last"],
      behaviors: ["behavior-last"],
      personality: ["personality-last"],
      humor_or_tone: ["humor-last"],
      summary: "summary-last",
      likes_dislikes: ["likes-last"],
      league: { role: "league-last" },
      other_games: ["game-last"],
      how_to_mimic: ["mimic-last"],
      quotes: Array.from(
        { length: 20 },
        (_, index) => `quote-${String(index)}`,
      ),
      sample_messages: Array.from(
        { length: 30 },
        (_, index) => `sample-${String(index)}`,
      ),
      situational_examples: {
        provenance: "synthetic",
        happy_or_excited: ["happy-0", "happy-1", "happy-2"],
        angry_or_frustrated: ["angry-0", "angry-1", "angry-2"],
        sad_or_disappointed: ["sad-0", "sad-1", "sad-2"],
        supportive_or_caring: ["supportive-0", "supportive-1", "supportive-2"],
        playful_or_teasing: ["playful-0", "playful-1", "playful-2"],
        neutral_or_logistical: ["neutral-0", "neutral-1", "neutral-2"],
      },
      concerns: ["concern-last"],
    });

    const serialized = serializeStyleCardForScoutPrompt(styleCard);
    const promptContext = StylePromptContextSchema.parse(
      JSON.parse(serialized),
    );

    expect(promptContext.quotes).toHaveLength(20);
    expect(promptContext.quotes.at(-1)).toBe("quote-19");
    expect(promptContext.sample_messages).toHaveLength(30);
    expect(promptContext.sample_messages.at(-1)).toBe("sample-29");
    expect(
      promptContext.situational_examples.neutral_or_logistical.at(-1),
    ).toBe("neutral-2");
    expect(serialized).toContain("concern-last");
    expect(serialized).not.toContain("schemaVersion");
    expect(serialized).not.toContain('"coverage"');
  });
});
