import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Glob } from "bun";
import path from "node:path";
import {
  buildPersonaPrompt,
  buildStyleContext,
} from "@shepherdjerred/birmel/persona/style-transform.ts";

const StyleCardSchema = z.object({
  author: z.string(),
  voice: z.array(z.string()),
  style_markers: z.array(z.string()),
  personality: z.array(z.string()),
  humor_or_tone: z.array(z.string()),
  how_to_mimic: z.array(z.string()),
  sample_messages: z.array(z.string()),
  summary: z.string(),
});

const STYLE_CARDS_DIR = path.resolve(import.meta.dir, "style-cards");

async function findStyleCardFiles(): Promise<string[]> {
  const glob = new Glob("*_style.json");
  const files: string[] = [];
  for await (const filename of glob.scan({ cwd: STYLE_CARDS_DIR })) {
    files.push(filename);
  }
  return files.toSorted();
}

describe("birmel style cards on disk", () => {
  test("at least 10 style cards are shipped", async () => {
    const files = await findStyleCardFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  test("every shipped style card parses against StyleCardSchema", async () => {
    const files = await findStyleCardFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const filename of files) {
      const filePath = path.join(STYLE_CARDS_DIR, filename);
      const raw: unknown = JSON.parse(await Bun.file(filePath).text());
      const result = StyleCardSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(
          `style card "${filename}" failed schema validation: ${result.error.message}`,
        );
      }
      expect(result.data.author.length).toBeGreaterThan(0);
      expect(result.data.voice.length).toBeGreaterThan(0);
      expect(result.data.sample_messages.length).toBeGreaterThan(0);
    }
  });
});

describe("buildStyleContext", () => {
  test("returns a style context for an existing persona (e.g. virmel)", async () => {
    const ctx = await buildStyleContext("virmel");
    if (ctx === null) {
      throw new Error("expected style context for virmel, got null");
    }
    expect(ctx.persona).toBe("virmel");
    expect(ctx.styleCard.author.length).toBeGreaterThan(0);
    expect(ctx.styleCard.sample_messages.length).toBeGreaterThan(0);
  });

  test("returns null when persona file is missing", async () => {
    const ctx = await buildStyleContext("does-not-exist-9f8e7d");
    expect(ctx).toBeNull();
  });
});

describe("buildPersonaPrompt", () => {
  test("produces a structured prompt for an existing persona", async () => {
    const prompt = await buildPersonaPrompt("virmel");
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
    const prompt = await buildPersonaPrompt("does-not-exist-9f8e7d");
    expect(prompt).toBeNull();
  });
});
