import { z } from "zod";
import rawContract from "./voice-cascade.contract.json" with { type: "json" };

/**
 * The local voice cascade Scout Desktop runs before any audio leaves the
 * device: sherpa-onnx keyword spotting for "hey scout", the openWakeWord-style
 * phrase verifier, and Silero VAD for end of speech. The language-neutral
 * source of truth is `voice-cascade.contract.json`; the Rust `scout-voice`
 * crate reads the same file with serde, and both sides run
 * `voice-cascade.fixtures.json` so they cannot drift.
 *
 * The verifier's acceptance threshold is not here: it ships with the trained
 * classifier in `wake-verifier.json`, beside the checksums it was scored
 * against.
 */

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const HttpsUrlSchema = z
  .string()
  .max(512)
  .regex(/^https:\/\/\S+$/);
const FileNameSchema = z.string().regex(/^[a-z0-9][\w.-]{0,127}$/i);
const PositiveMsSchema = z.number().int().positive().max(600_000);
const NonNegativeMsSchema = z.number().int().nonnegative().max(600_000);
const UnitIntervalSchema = z.number().gt(0).lt(1);

const ModelFileSchema = z.strictObject({
  name: FileNameSchema,
  sha256: Sha256Schema,
});

export const VoiceCascadeContractSchema = z
  .strictObject({
    contractVersion: z.literal(1),
    audio: z.strictObject({
      sampleRateHz: z.literal(16_000),
      channels: z.literal(1),
      frameMs: z.number().int().min(10).max(100),
    }),
    wake: z.strictObject({
      phrases: z.array(z.string().min(1).max(64)).min(1),
      transcriptPrefixes: z.array(z.string().min(1).max(64)).min(1),
      keywordSpotter: z.strictObject({
        featureDim: z.literal(80),
        maxActivePaths: z.number().int().min(1).max(64),
        numTrailingBlanks: z.number().int().min(0).max(16),
        keywordsScore: z.number().positive().max(10),
        keywordsThreshold: UnitIntervalSchema,
        numThreads: z.number().int().min(1).max(8),
      }),
      fragmentTailMs: z.record(
        z.string().regex(/^[A-Z][A-Z_]*$/),
        NonNegativeMsSchema,
      ),
      fragmentTailMarginMs: NonNegativeMsSchema,
      verificationDelayMs: PositiveMsSchema,
      verifierWindowMs: PositiveMsSchema,
    }),
    vad: z.strictObject({
      threshold: UnitIntervalSchema,
      minSilenceMs: PositiveMsSchema,
      minSpeechMs: PositiveMsSchema,
      windowSamples: z.literal(512),
      maxSpeechMs: PositiveMsSchema,
      bufferSeconds: z.number().int().min(1).max(120),
    }),
    utterance: z.strictObject({
      preRollMs: PositiveMsSchema,
      maxUtteranceMs: PositiveMsSchema,
      postVerificationMs: NonNegativeMsSchema,
    }),
    models: z.strictObject({
      keywordSpotter: z.strictObject({
        archiveUrl: HttpsUrlSchema,
        archiveSha256: Sha256Schema,
        encoder: ModelFileSchema,
        decoder: ModelFileSchema,
        joiner: ModelFileSchema,
        tokens: ModelFileSchema,
        bpe: ModelFileSchema,
        keywords: ModelFileSchema,
      }),
      vad: z.strictObject({
        url: HttpsUrlSchema,
        name: FileNameSchema,
        sha256: Sha256Schema,
      }),
      verifier: z.strictObject({
        manifest: FileNameSchema,
        melspectrogram: FileNameSchema,
        embedding: FileNameSchema,
        classifier: FileNameSchema,
        smokePositive: FileNameSchema,
      }),
    }),
  })
  .refine(
    (contract) =>
      contract.utterance.preRollMs >= contract.wake.verifierWindowMs,
    {
      message: "the pre-roll must cover the verifier window",
      path: ["utterance", "preRollMs"],
    },
  );
export type VoiceCascadeContract = z.infer<typeof VoiceCascadeContractSchema>;

/** The parsed shared contract; importing this module fails if it is invalid. */
export const SCOUT_VOICE_CASCADE: VoiceCascadeContract =
  VoiceCascadeContractSchema.parse(rawContract);
