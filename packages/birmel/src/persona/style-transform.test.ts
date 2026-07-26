import { describe, expect, test } from "bun:test";
import {
  buildPersonaPrompt,
  buildStyleContext,
} from "@shepherdjerred/birmel/persona/style-transform.ts";
import {
  getStyleCard,
  listStyleCardNames,
} from "@shepherdjerred/glitter-context";
import { StyleCardSchema } from "@shepherdjerred/glitter-context/schema";

describe("shared Birmel style cards", () => {
  test("all 13 style cards are shipped", () => {
    expect(listStyleCardNames()).toHaveLength(13);
  });

  test("every shared style card parses against StyleCardSchema", () => {
    for (const name of listStyleCardNames()) {
      const card = getStyleCard(name);
      if (card === undefined) {
        throw new Error(`style card "${name}" is not loadable`);
      }
      const parsed = StyleCardSchema.parse(card);
      expect(parsed.author.length).toBeGreaterThan(0);
      expect(parsed.voice.length).toBeGreaterThan(0);
      expect(parsed.sample_messages.length).toBeGreaterThan(0);
    }
  });
});

describe("buildStyleContext", () => {
  test("returns a style context for an existing persona (e.g. virmel)", async () => {
    const ctx = buildStyleContext("virmel");
    if (ctx === null) {
      throw new Error("expected style context for virmel, got null");
    }
    expect(ctx.persona).toBe("virmel");
    expect(ctx.styleCard.author.length).toBeGreaterThan(0);
    expect(ctx.styleCard.sample_messages.length).toBeGreaterThan(0);
  });

  test("returns null when persona file is missing", async () => {
    const ctx = buildStyleContext("does-not-exist-9f8e7d");
    expect(ctx).toBeNull();
  });
});

describe("buildPersonaPrompt", () => {
  test("produces a structured prompt for an existing persona", async () => {
    const prompt = buildPersonaPrompt("virmel");
    if (prompt === null) {
      throw new Error("expected persona prompt for virmel, got null");
    }
    expect(prompt.name).toBe("virmel");
    expect(prompt.voice.length).toBeGreaterThan(0);
    expect(prompt.markers.length).toBeGreaterThan(0);
    expect(prompt.samples.length).toBeGreaterThan(0);
    expect(prompt.samples.length).toBeLessThanOrEqual(10);
    expect(prompt.voice.startsWith("- ")).toBe(true);
    expect(prompt.markers.startsWith("- ")).toBe(true);
  });

  test("returns null when persona file is missing (silent-skip path)", async () => {
    const prompt = buildPersonaPrompt("does-not-exist-9f8e7d");
    expect(prompt).toBeNull();
  });
});
