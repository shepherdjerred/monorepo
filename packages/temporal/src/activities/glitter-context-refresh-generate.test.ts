import { describe, expect, test } from "bun:test";
import { zodResponseFormat } from "openai/helpers/zod";
import { GeneratedStyleCardSchema } from "./glitter-context-refresh-generate.ts";

describe("Glitter generated style-card schema", () => {
  test("converts to an OpenAI strict Structured Outputs schema", () => {
    expect(() =>
      zodResponseFormat(GeneratedStyleCardSchema, "style_card"),
    ).not.toThrow();
  });

  test("requires nullable concerns and omits persisted metadata", () => {
    const result = GeneratedStyleCardSchema.safeParse({
      voice: [],
      style_markers: [],
      topics: [],
      relationships: [],
      behaviors: [],
      personality: [],
      humor_or_tone: [],
      quotes: [],
      summary: "",
      likes_dislikes: [],
      league: [],
      other_games: [],
      how_to_mimic: [],
      sample_messages: [],
      concerns: null,
    });

    expect(result.success).toBe(true);
  });
});
