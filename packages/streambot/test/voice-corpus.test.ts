import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  VOICE_CORPUS_CLIP_COUNT,
  VoiceCorpusManifestSchema,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import {
  decodeDiscordOpusContainer,
  encodeDiscordOpusContainer,
} from "@shepherdjerred/streambot/voice/discord-opus-container.ts";
import { expandVoiceCorpusRecipes } from "@shepherdjerred/streambot/voice/corpus-recipes.ts";
import {
  generateVoiceCorpus,
  type SyntheticTtsClient,
} from "@shepherdjerred/streambot/voice/corpus-generator.ts";
import { verifyVoiceCorpus } from "@shepherdjerred/streambot/voice/corpus-io.ts";

describe("Discord Opus fixture container", () => {
  test("round-trips length-prefixed 20ms packets", () => {
    const packets = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    expect(
      decodeDiscordOpusContainer(encodeDiscordOpusContainer(packets)),
    ).toEqual({
      packets,
      durationMs: 40,
    });
  });

  test("rejects truncation and trailing bytes", () => {
    const encoded = encodeDiscordOpusContainer([new Uint8Array([1, 2, 3])]);
    expect(() => decodeDiscordOpusContainer(encoded.slice(0, -1))).toThrow(
      "Truncated",
    );
    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    expect(() => decodeDiscordOpusContainer(trailing)).toThrow(
      "trailing bytes",
    );
  });
});

describe("voice corpus recipes", () => {
  test("expands the exact acceptance matrix with all configured voices", () => {
    const recipes = expandVoiceCorpusRecipes();
    expect(recipes).toHaveLength(VOICE_CORPUS_CLIP_COUNT);
    expect(
      recipes.filter((entry) => entry.category === "clean-positive"),
    ).toHaveLength(160);
    expect(
      recipes.filter((entry) => entry.category === "stress-positive"),
    ).toHaveLength(80);
    expect(
      recipes.filter((entry) => entry.expected === "no-wake"),
    ).toHaveLength(160);
    expect(new Set(recipes.map((entry) => entry.id)).size).toBe(
      VOICE_CORPUS_CLIP_COUNT,
    );
    expect(
      new Set(
        recipes
          .filter((entry) => entry.provider === "openai")
          .map((entry) => entry.voice),
      ).size,
    ).toBe(13);
    expect(
      new Set(
        recipes
          .filter((entry) => entry.provider === "apple")
          .map((entry) => entry.voice),
      ).size,
    ).toBe(10);
    expect(
      new Set(
        recipes
          .filter((entry) => entry.provider === "apple")
          .map((entry) => entry.rateWpm),
      ),
    ).toEqual(new Set([130, 180, 240]));
  });

  test("manifest rejects malformed hashes and unknown fields", () => {
    expect(() =>
      VoiceCorpusManifestSchema.parse({
        version: 1,
        format: "streambot-discord-opus-v1",
        disclosure:
          "AI-generated and procedurally generated speech/audio; no recordings of people or copyrighted media.",
        entries: [],
        unexpected: true,
      }),
    ).toThrow();
  });
});

describe("voice corpus generation", () => {
  test("is atomic/resumable and requires refresh to replace a canonical recipe", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "streambot-corpus-"));
    let calls = 0;
    const client: SyntheticTtsClient = {
      synthesize: () => {
        calls += 1;
        return Promise.resolve(new Uint8Array(960));
      },
    };
    const recipe = expandVoiceCorpusRecipes()[0];
    if (recipe === undefined) throw new Error("Recipe expansion is empty");
    const options = {
      corpusDir: directory,
      clients: { openai: client, apple: client },
      recipes: [recipe],
      normalize: (pcm: Uint8Array) => Promise.resolve(pcm),
      encode: () => [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
    };
    try {
      const first = await generateVoiceCorpus(options);
      expect(first.entries).toHaveLength(1);
      expect(calls).toBe(1);
      await generateVoiceCorpus(options);
      expect(calls).toBe(1);
      expect(await verifyVoiceCorpus(directory, false)).toEqual({
        clipCount: 1,
        totalBytes: 26,
      });
      await expect(
        generateVoiceCorpus({
          ...options,
          recipes: [{ ...recipe, text: `${recipe.text} changed` }],
        }),
      ).rejects.toThrow("--refresh");
      await generateVoiceCorpus({ ...options, refresh: true });
      expect(calls).toBe(2);
      expect(
        await Bun.file(path.join(directory, "manifest.json")).text(),
      ).toEndWith("\n");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
