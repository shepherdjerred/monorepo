import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { VoiceAssetManifest } from "@shepherdjerred/voice-assistant/asset-manifest.ts";
import {
  SCOUT_VOICE_PHRASE_SPEC,
  STREAMBOT_VOICE_PHRASE_SPEC,
  type VoiceCorpusPhraseSpec,
} from "@shepherdjerred/streambot/voice/corpus-recipes.ts";
import { DEFAULT_VOICE_CORPUS_DIR } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import {
  streambotVoiceAssetManifest,
  VOICE_FRAGMENT_TAIL_MS,
} from "@shepherdjerred/streambot/voice/constants.ts";

/**
 * The wake-word corpus/training/packaging tooling lives in streambot but serves every trained
 * phrase. A profile bundles the per-phrase facts the tools need: the corpus spec, where that
 * phrase's fixtures and assets live, how its asset manifest is shaped, and its fragment-tail
 * table. Streambot's profile reproduces the historical tool behavior exactly.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const SCOUT_BACKEND_DIR = path.join(
  REPO_ROOT,
  "packages/scout-for-lol/packages/backend",
);
export const SCOUT_VOICE_ASSETS_DIR = path.join(
  SCOUT_BACKEND_DIR,
  "assets/voice",
);

/** sherpa KWS keyword-file line: `<bpe pieces> :<boost> #<threshold> @LABEL`. */
export type WakeKeywordFragment = {
  readonly label: string;
  /** Uppercase words; encoded into BPE pieces with the pinned base model's `bpe.model`. */
  readonly text: string;
  readonly boost: number;
  readonly threshold: number;
};

export type VoiceWakePhraseProfile = {
  readonly slug: "hey-streambot" | "hey-scout";
  readonly spec: VoiceCorpusPhraseSpec;
  /** Committed canonical corpus fixtures for this phrase. */
  readonly corpusDir: string;
  /** Default `--assets-dir` for offline evaluation of this phrase. */
  readonly defaultAssetsDir: string;
  readonly defaultCorpusReportPath: string;
  readonly humanHoldoutReportName: string;
  readonly assetManifest: (assetsDir: string) => VoiceAssetManifest;
  readonly loadFragmentTailMs: () => Promise<Readonly<Record<string, number>>>;
  readonly keywordFragments: readonly WakeKeywordFragment[];
};

/**
 * Slug-derived wake-asset filenames shared by the packager, keyword generator, and asset
 * manifests, so one slug can never produce two spellings of the same artifact.
 */
export function wakeVerifierFileNames(slug: string): {
  readonly keywords: string;
  readonly classifier: string;
  readonly smokePositive: string;
  readonly trainedModelName: string;
} {
  const underscored = slug.replaceAll("-", "_");
  return {
    keywords: `${slug}.txt`,
    classifier: `${underscored}.onnx`,
    smokePositive: `${slug}-smoke.wav`,
    trainedModelName: `${underscored}_cascade`,
  };
}

/**
 * Base-model filenames from the pinned sherpa KWS archive plus the slug-derived wake assets.
 * Streambot's own manifest stays in `constants.ts` (it is a runtime contract, not tooling); this
 * builder serves phrases whose runtime integration has not landed yet.
 */
function wakeAssetManifestForSlug(
  slug: string,
): (assetsDir: string) => VoiceAssetManifest {
  const names = wakeVerifierFileNames(slug);
  return (assetsDir) => ({
    assetsDir,
    files: {
      encoder: "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      decoder: "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      joiner: "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
      tokens: "tokens.txt",
      bpe: "bpe.model",
      keywords: names.keywords,
      smokeKeywords: "test_wavs/test_keywords.txt",
      smokePositive: "test_wavs/0.wav",
      vad: "silero_vad.onnx",
      wakeMel: "melspectrogram.onnx",
      wakeEmbedding: "embedding_model.onnx",
      wakeClassifier: names.classifier,
      wakeSmokePositive: names.smokePositive,
      wakeManifest: "wake-verifier.json",
    },
  });
}

const FragmentTailsFileSchema = z.strictObject({
  note: z.string(),
  tails: z.record(z.string(), z.number().int().nonnegative()),
});

async function loadScoutFragmentTailMs(): Promise<
  Readonly<Record<string, number>>
> {
  const file = Bun.file(
    path.join(SCOUT_VOICE_ASSETS_DIR, "fragment-tails.json"),
  );
  return FragmentTailsFileSchema.parse(await file.json()).tails;
}

const STREAMBOT_KEYWORD_FRAGMENTS: readonly WakeKeywordFragment[] = [
  { label: "HEY_STREAMBOT", text: "HEY STREAMBOT", boost: 2, threshold: 0.05 },
  {
    label: "HEY_STREAM_BOT",
    text: "HEY STREAM BOT",
    boost: 2,
    threshold: 0.05,
  },
  { label: "HEY", text: "HEY", boost: 2, threshold: 0.05 },
  { label: "STREAM", text: "STREAM", boost: 2, threshold: 0.05 },
  { label: "STREAMBOT", text: "STREAMBOT", boost: 2, threshold: 0.05 },
  { label: "BOT", text: "BOT", boost: 2, threshold: 0.05 },
];

/**
 * "scout" is common speech, so `@SCOUT` starts at a higher per-line threshold than the
 * permissive 0.05 default — raise it further during evaluation if the candidate rate is high,
 * rather than ever touching the global `keywordsThreshold`.
 */
const SCOUT_KEYWORD_FRAGMENTS: readonly WakeKeywordFragment[] = [
  { label: "HEY_SCOUT", text: "HEY SCOUT", boost: 2, threshold: 0.05 },
  { label: "SCOUT", text: "SCOUT", boost: 2, threshold: 0.15 },
  { label: "HEY", text: "HEY", boost: 2, threshold: 0.05 },
];

const STREAMBOT_PROFILE: VoiceWakePhraseProfile = {
  slug: "hey-streambot",
  spec: STREAMBOT_VOICE_PHRASE_SPEC,
  corpusDir: DEFAULT_VOICE_CORPUS_DIR,
  defaultAssetsDir: "/opt/streambot/voice",
  defaultCorpusReportPath: "/tmp/streambot-voice-corpus-report.json",
  humanHoldoutReportName: "streambot-human-holdout-result.json",
  assetManifest: streambotVoiceAssetManifest,
  loadFragmentTailMs: () => Promise.resolve(VOICE_FRAGMENT_TAIL_MS),
  keywordFragments: STREAMBOT_KEYWORD_FRAGMENTS,
};

const SCOUT_PROFILE: VoiceWakePhraseProfile = {
  slug: "hey-scout",
  spec: SCOUT_VOICE_PHRASE_SPEC,
  corpusDir: path.join(SCOUT_BACKEND_DIR, "test/fixtures/voice-corpus"),
  defaultAssetsDir: path.join(REPO_ROOT, ".context/scout-voice-models"),
  defaultCorpusReportPath: "/tmp/scout-voice-corpus-report.json",
  humanHoldoutReportName: "scout-human-holdout-result.json",
  assetManifest: wakeAssetManifestForSlug("hey-scout"),
  loadFragmentTailMs: loadScoutFragmentTailMs,
  keywordFragments: SCOUT_KEYWORD_FRAGMENTS,
};

export const VOICE_WAKE_PHRASES = {
  "hey-streambot": STREAMBOT_PROFILE,
  "hey-scout": SCOUT_PROFILE,
} as const;

export type VoiceWakePhraseSlug = keyof typeof VOICE_WAKE_PHRASES;

/**
 * Shared `--phrase`/`--help` parsing for the CLIs that take no other flags. Printing `helpText`
 * and exiting is the whole help behavior, so every such script shares this exactly rather than
 * re-declaring the same parseArgs call and exit.
 */
export function parsePhraseCliArgs(helpText: string): { phrase?: string } {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      phrase: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(helpText);
    process.exit(0);
  }
  return values;
}

export function resolveVoiceWakePhrase(
  slug = "hey-streambot",
): VoiceWakePhraseProfile {
  if (slug === "hey-streambot" || slug === "hey-scout") {
    return VOICE_WAKE_PHRASES[slug];
  }
  throw new Error(
    `Unknown wake phrase "${slug}"; expected one of: ${Object.keys(VOICE_WAKE_PHRASES).join(", ")}`,
  );
}

/**
 * Everything the verifier packager derives from its flags. Defaults reproduce the historical
 * hey-streambot behavior byte-for-byte: same classifier source name, same destination, same
 * output filenames.
 */
export function verifierPackagingPlan(
  slug: string,
  destination?: string,
): {
  readonly classifierSourceName: string;
  readonly destination: string;
  readonly outputs: {
    readonly mel: string;
    readonly embedding: string;
    readonly classifier: string;
    readonly smokePositive: string;
  };
} {
  resolveVoiceWakePhrase(slug);
  const names = wakeVerifierFileNames(slug);
  return {
    classifierSourceName: `${names.trainedModelName}.onnx`,
    destination:
      destination ??
      (slug === "hey-streambot"
        ? path.join(REPO_ROOT, "packages/streambot/assets/voice")
        : SCOUT_VOICE_ASSETS_DIR),
    outputs: {
      mel: "melspectrogram.onnx",
      embedding: "embedding_model.onnx",
      classifier: names.classifier,
      smokePositive: names.smokePositive,
    },
  };
}
