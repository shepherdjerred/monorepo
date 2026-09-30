import { z } from "zod";

export const VOICE_CORPUS_VERSION = 1;
export const VOICE_CORPUS_CLIP_COUNT = 400;
export const VOICE_CORPUS_MAX_BYTES = 20 * 1024 * 1024;

/**
 * One manifest format literal per wake-phrase corpus, so a corpus can never be verified or
 * evaluated against another phrase's fixtures by accident. Parsing always pins the exact literal
 * for the corpus being read; the union exists only for typing manifests generically.
 */
export const VOICE_CORPUS_FORMATS = [
  "streambot-discord-opus-v1",
  "scout-discord-opus-v1",
] as const;

export type VoiceCorpusFormat = (typeof VOICE_CORPUS_FORMATS)[number];

export const VoiceCorpusAugmentationSchema = z.strictObject({
  kind: z.enum([
    "clean",
    "moderate",
    "noise",
    "echo",
    "packet-loss",
    "overlap",
    "music-like",
  ]),
  snrDb: z.number().nullable(),
  packetLossPercent: z.number().int().min(0).max(30),
  echo: z.boolean(),
  overlap: z.boolean(),
});

export const VoiceCorpusEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string().regex(/^clips\/[a-z0-9-]+\.dopus$/),
  expected: z.enum(["wake", "no-wake"]),
  category: z.enum([
    "clean-positive",
    "stress-positive",
    "near-match-negative",
    "ordinary-negative",
    "background-negative",
  ]),
  provider: z.enum(["openai", "apple", "procedural"]),
  model: z.string().min(1),
  voice: z.string().min(1),
  style: z.enum(["neutral", "quiet", "hurried", "distant", "hesitant"]),
  rateWpm: z.number().int().positive().nullable(),
  text: z.string(),
  augmentation: VoiceCorpusAugmentationSchema,
  durationMs: z.number().int().positive(),
  speechEndMs: z.number().int().nonnegative().nullable(),
  split: z.enum(["tuning", "holdout"]),
  aiGenerated: z.literal(true),
  packetCount: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export function voiceCorpusManifestSchema(format: VoiceCorpusFormat) {
  return z.strictObject({
    version: z.literal(VOICE_CORPUS_VERSION),
    format: z.literal(format),
    disclosure: z.literal(
      "AI-generated and procedurally generated speech/audio; no recordings of people or copyrighted media.",
    ),
    entries: z.array(VoiceCorpusEntrySchema).max(VOICE_CORPUS_CLIP_COUNT),
  });
}

/** The historical streambot corpus schema; per-phrase code uses the factory above. */
export const VoiceCorpusManifestSchema = voiceCorpusManifestSchema(
  "streambot-discord-opus-v1",
);

export type VoiceCorpusEntry = z.infer<typeof VoiceCorpusEntrySchema>;
export type VoiceCorpusManifest = z.infer<
  ReturnType<typeof voiceCorpusManifestSchema>
>;
export type VoiceCorpusAugmentation = z.infer<
  typeof VoiceCorpusAugmentationSchema
>;
