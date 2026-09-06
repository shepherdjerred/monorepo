import { z } from "zod";

/**
 * Explicit filenames for every pinned local-model asset, replacing hard-coded per-phrase names.
 * Entries are joined onto `assetsDir` and may contain subdirectories (the sherpa smoke fixtures
 * ship under `test_wavs/`). The keyword file, the trained wake-verifier graph, and the smoke
 * fixtures are one packaging contract: each consumer builds exactly one manifest for its phrase.
 */
export type VoiceAssetManifest = {
  readonly assetsDir: string;
  readonly files: {
    readonly encoder: string;
    readonly decoder: string;
    readonly joiner: string;
    readonly tokens: string;
    readonly bpe: string;
    readonly keywords: string;
    readonly smokeKeywords: string;
    readonly smokePositive: string;
    readonly vad: string;
    readonly wakeMel: string;
    readonly wakeEmbedding: string;
    readonly wakeClassifier: string;
    readonly wakeSmokePositive: string;
    readonly wakeManifest: string;
  };
};

/** Phrase-agnostic wake-verifier packaging manifest (`wake-verifier.json`). */
export const WakeVerifierManifestSchema = z.strictObject({
  version: z.literal(1),
  threshold: z.number().min(0).max(1),
  assets: z.strictObject({
    melspectrogram: z.string().regex(/^[a-f0-9]{64}$/u),
    embedding: z.string().regex(/^[a-f0-9]{64}$/u),
    classifier: z.string().regex(/^[a-f0-9]{64}$/u),
    smokePositive: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  training: z.strictObject({
    positiveUtterances: z.number().int().min(20_000),
    adversarialUtterances: z.number().int().min(40_000),
    generalNegativeHours: z.number().min(25),
    humanHoldoutIncluded: z.literal(false),
  }),
});
