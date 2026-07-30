import { describe, expect, it, mock } from "bun:test";
import * as aiActual from "ai";
import { StylePromptContextSchema } from "@shepherdjerred/glitter-context/schema";

type ClassifierObject = { shouldRespond: boolean; reason?: string };

// Mutable implementation so each test can swap behavior without re-importing
// the module under test (which captures `generateText` at load time).
let generateTextImpl: (args: {
  prompt: string;
}) => Promise<{ output: ClassifierObject }>;
let lastPrompt = "";

// Spread the real `ai` exports so the rest of the package (which imports
// `stepCountIs`, etc. from `ai`) keeps working — this mock is process-global.
// `generateText` is mocked, so the real `openai()` model arg is never used
// and no network call happens.
await mock.module("ai", () => ({
  ...aiActual,
  generateText: (args: { prompt: string }) => {
    lastPrompt = args.prompt;
    return generateTextImpl(args);
  },
}));

const { buildClassifierPersonaBlock, classifyShouldRespond } =
  await import("./should-respond-classifier.ts");

const baseInput = {
  persona: "virmel",
  transcript: "Alice: hey birmel",
  latestMessage: "Alice: you there?",
  guildId: "g",
  channelId: "c",
  userId: "u",
};

describe("classifyShouldRespond", () => {
  it("passes the complete metadata-free V2 context to the classifier", () => {
    const style = StylePromptContextSchema.parse({
      author: "Classifier Sentinel",
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

    const block = buildClassifierPersonaBlock("sentinel", {
      format: "thick",
      name: "sentinel",
      style,
    });

    expect(block).toContain('"quote-19"');
    expect(block).toContain('"sample-29"');
    expect(block).toContain('"neutral-2"');
    expect(block).toContain('"concern-last"');
    expect(block).not.toContain("schemaVersion");
    expect(block).not.toContain('"coverage"');
  });

  it("returns the model's decision and feeds it persona + transcript", async () => {
    generateTextImpl = async () => ({
      output: { shouldRespond: true, reason: "directed at me" },
    });
    const result = await classifyShouldRespond(baseInput);
    expect(result).toBe(true);
    expect(lastPrompt).toContain("virmel");
    expect(lastPrompt).toContain("Alice: hey birmel");
    expect(lastPrompt).toContain("Alice: you there?");
  });

  it("returns false when the model declines", async () => {
    generateTextImpl = async () => ({
      output: { shouldRespond: false },
    });
    expect(await classifyShouldRespond(baseInput)).toBe(false);
  });

  it("fails closed when the model call throws", async () => {
    generateTextImpl = async () => {
      throw new Error("api down");
    };
    expect(await classifyShouldRespond(baseInput)).toBe(false);
  });
});
