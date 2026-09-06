import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  expandVoiceCorpusRecipes,
  SCOUT_VOICE_PHRASE_SPEC,
  STREAMBOT_VOICE_PHRASE_SPEC,
  voiceCorpusClipCount,
} from "@shepherdjerred/streambot/voice/corpus-recipes.ts";
import {
  voiceCorpusManifestSchema,
  VoiceCorpusManifestSchema,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import {
  resolveVoiceWakePhrase,
  verifierPackagingPlan,
  VOICE_WAKE_PHRASES,
  wakeVerifierFileNames,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";
import {
  generateVoiceCorpus,
  type SyntheticTtsClient,
} from "@shepherdjerred/streambot/voice/corpus-generator.ts";
import {
  loadVoiceCorpusManifest,
  verifyVoiceCorpus,
} from "@shepherdjerred/streambot/voice/corpus-io.ts";

/**
 * SHA-256 of `JSON.stringify(expandVoiceCorpusRecipes())` captured on the commit before the
 * phrase-spec parameterization. The streambot corpus recipes are a committed-fixture contract:
 * any drift here would demand regenerating 400 canonical clips.
 */
const STREAMBOT_RECIPES_GOLDEN_SHA256 =
  "cbcdd670d1e31c5b4aa050ea33fabfc69b18041515186d3e452cf72869dda1b2";

describe("streambot recipe golden", () => {
  test("the default expansion is byte-identical to the pre-parameterization recipes", () => {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(JSON.stringify(expandVoiceCorpusRecipes()));
    expect(hasher.digest("hex")).toBe(STREAMBOT_RECIPES_GOLDEN_SHA256);
  });

  test("the default expansion equals the explicit streambot spec expansion", () => {
    expect(expandVoiceCorpusRecipes(STREAMBOT_VOICE_PHRASE_SPEC)).toEqual(
      expandVoiceCorpusRecipes(),
    );
  });
});

describe("scout phrase spec", () => {
  test("expands to the canonical 400-clip category mix", () => {
    const recipes = expandVoiceCorpusRecipes(SCOUT_VOICE_PHRASE_SPEC);
    expect(recipes).toHaveLength(400);
    expect(voiceCorpusClipCount(SCOUT_VOICE_PHRASE_SPEC)).toBe(400);
    const byCategory = (category: string) =>
      recipes.filter((recipe) => recipe.category === category).length;
    expect(byCategory("clean-positive")).toBe(160);
    expect(byCategory("stress-positive")).toBe(80);
    expect(byCategory("near-match-negative")).toBe(60);
    expect(byCategory("ordinary-negative")).toBe(60);
    expect(byCategory("background-negative")).toBe(40);
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(400);
  });

  test("every positive is a Hey Scout League question", () => {
    const positives = expandVoiceCorpusRecipes(SCOUT_VOICE_PHRASE_SPEC).filter(
      (recipe) => recipe.expected === "wake",
    );
    expect(positives.length).toBe(240);
    for (const recipe of positives) {
      expect(recipe.text.startsWith("Hey Scout, ")).toBe(true);
      expect(recipe.text.endsWith("?")).toBe(true);
    }
  });

  test("near-matches cover the bare and common scout bucket", () => {
    const nearMatchTexts = new Set(
      expandVoiceCorpusRecipes(SCOUT_VOICE_PHRASE_SPEC)
        .filter((recipe) => recipe.category === "near-match-negative")
        .map((recipe) => recipe.text),
    );
    for (const required of [
      "The boy scout troop meets on Thursday night.",
      "Go scout the jungle before the next fight.",
      "You should ask scout about the match later.",
      "Hey Scott, are you watching the game tonight?",
      "Hey, scoot over so I can see the map.",
    ]) {
      expect(nearMatchTexts.has(required)).toBe(true);
    }
    for (const text of nearMatchTexts) {
      expect(text.toLowerCase().includes("hey scout")).toBe(false);
    }
  });
});

function manifestJson(format: string) {
  return {
    version: 1,
    format,
    disclosure:
      "AI-generated and procedurally generated speech/audio; no recordings of people or copyrighted media.",
    entries: [],
  };
}

describe("per-corpus manifest format literal", () => {
  test("each schema pins its own format and rejects the other corpus", () => {
    const scout = voiceCorpusManifestSchema("scout-discord-opus-v1");
    expect(scout.parse(manifestJson("scout-discord-opus-v1")).format).toBe(
      "scout-discord-opus-v1",
    );
    expect(() =>
      scout.parse(manifestJson("streambot-discord-opus-v1")),
    ).toThrow();
    expect(() =>
      VoiceCorpusManifestSchema.parse(manifestJson("scout-discord-opus-v1")),
    ).toThrow();
    expect(
      VoiceCorpusManifestSchema.parse(manifestJson("streambot-discord-opus-v1"))
        .format,
    ).toBe("streambot-discord-opus-v1");
  });
});

describe("phrase profiles", () => {
  test("the default phrase is hey-streambot and unknown slugs fail loudly", () => {
    expect(resolveVoiceWakePhrase(undefined).slug).toBe("hey-streambot");
    expect(resolveVoiceWakePhrase("hey-scout").slug).toBe("hey-scout");
    expect(() => resolveVoiceWakePhrase("hey-cortana")).toThrow(
      'Unknown wake phrase "hey-cortana"',
    );
  });

  test("slug-derived wake asset filenames", () => {
    expect(wakeVerifierFileNames("hey-streambot")).toEqual({
      keywords: "hey-streambot.txt",
      classifier: "hey_streambot.onnx",
      smokePositive: "hey-streambot-smoke.wav",
      trainedModelName: "hey_streambot_cascade",
    });
    expect(wakeVerifierFileNames("hey-scout")).toEqual({
      keywords: "hey-scout.txt",
      classifier: "hey_scout.onnx",
      smokePositive: "hey-scout-smoke.wav",
      trainedModelName: "hey_scout_cascade",
    });
  });

  test("the scout asset manifest names scout wake assets over the shared base model", () => {
    const manifest = VOICE_WAKE_PHRASES["hey-scout"].assetManifest("/assets");
    expect(manifest.assetsDir).toBe("/assets");
    expect(manifest.files.keywords).toBe("hey-scout.txt");
    expect(manifest.files.wakeClassifier).toBe("hey_scout.onnx");
    expect(manifest.files.wakeSmokePositive).toBe("hey-scout-smoke.wav");
    const streambot =
      VOICE_WAKE_PHRASES["hey-streambot"].assetManifest("/assets");
    expect(manifest.files.tokens).toBe(streambot.files.tokens);
    expect(manifest.files.encoder).toBe(streambot.files.encoder);
    expect(manifest.files.vad).toBe(streambot.files.vad);
  });

  test("scout fragment tails load from the committed table", async () => {
    const tails = await VOICE_WAKE_PHRASES["hey-scout"].loadFragmentTailMs();
    expect(tails).toEqual({ HEY_SCOUT: 0, SCOUT: 0, HEY: 500 });
  });

  test("the committed hey-scout keywords file matches the profile's fragments", async () => {
    const profile = VOICE_WAKE_PHRASES["hey-scout"];
    const file = path.join(
      verifierPackagingPlan("hey-scout").destination,
      wakeVerifierFileNames("hey-scout").keywords,
    );
    const contents = await Bun.file(file).text();
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(profile.keywordFragments.length);
    for (const [index, fragment] of profile.keywordFragments.entries()) {
      const line = lines[index];
      if (line === undefined) throw new Error("keyword line missing");
      expect(line.endsWith(`@${fragment.label}`)).toBe(true);
      expect(line.includes(` :${fragment.boost.toFixed(1)} `)).toBe(true);
      expect(line.includes(` #${fragment.threshold.toFixed(2)} `)).toBe(true);
    }
  });
});

describe("verifier packaging plan", () => {
  test("defaults reproduce the historical hey-streambot packaging exactly", () => {
    const plan = verifierPackagingPlan("hey-streambot");
    expect(plan.classifierSourceName).toBe("hey_streambot_cascade.onnx");
    expect(
      plan.destination.endsWith(path.join("packages/streambot/assets/voice")),
    ).toBe(true);
    expect(plan.outputs).toEqual({
      mel: "melspectrogram.onnx",
      embedding: "embedding_model.onnx",
      classifier: "hey_streambot.onnx",
      smokePositive: "hey-streambot-smoke.wav",
    });
  });

  test("the scout slug retargets classifier source, destination, and outputs", () => {
    const plan = verifierPackagingPlan("hey-scout");
    expect(plan.classifierSourceName).toBe("hey_scout_cascade.onnx");
    expect(
      plan.destination.endsWith(
        path.join("packages/scout-for-lol/packages/backend/assets/voice"),
      ),
    ).toBe(true);
    expect(plan.outputs.classifier).toBe("hey_scout.onnx");
    expect(plan.outputs.smokePositive).toBe("hey-scout-smoke.wav");
  });

  test("an explicit destination overrides the committed default", () => {
    expect(
      verifierPackagingPlan("hey-scout", "/tmp/elsewhere").destination,
    ).toBe("/tmp/elsewhere");
  });

  test("an unknown slug fails loudly", () => {
    expect(() => verifierPackagingPlan("hey-bixby")).toThrow(
      'Unknown wake phrase "hey-bixby"',
    );
  });
});

describe("scout corpus generation plumbing", () => {
  test("generates a scout-format manifest that scout-format IO round-trips", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "scout-corpus-"));
    const client: SyntheticTtsClient = {
      synthesize: () => Promise.resolve(new Uint8Array(960)),
    };
    const recipe = expandVoiceCorpusRecipes(SCOUT_VOICE_PHRASE_SPEC)[0];
    if (recipe === undefined) throw new Error("Scout recipe expansion empty");
    try {
      const manifest = await generateVoiceCorpus({
        corpusDir: directory,
        spec: SCOUT_VOICE_PHRASE_SPEC,
        clients: { openai: client, apple: client },
        recipes: [recipe],
        normalize: (pcm: Uint8Array) => Promise.resolve(pcm),
        encode: () => [new Uint8Array([1, 2, 3])],
      });
      expect(manifest.format).toBe("scout-discord-opus-v1");
      const loaded = await loadVoiceCorpusManifest(
        directory,
        "scout-discord-opus-v1",
      );
      expect(loaded.entries).toHaveLength(1);
      // Streambot-format IO must refuse the scout corpus outright.
      await expect(loadVoiceCorpusManifest(directory)).rejects.toThrow();
      const verified = await verifyVoiceCorpus(
        directory,
        false,
        SCOUT_VOICE_PHRASE_SPEC,
      );
      expect(verified.clipCount).toBe(1);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
