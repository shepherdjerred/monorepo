import { z } from "zod";

const AudioObjectSchema = z.strictObject({
  key: z.string().min(1),
  filename: z.string().min(1),
  userId: z.string().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().nonnegative(),
  sampleRate: z.literal(16_000),
  channels: z.literal(1),
  encoding: z.literal("pcm_s16le"),
  durationSeconds: z.number().nonnegative(),
});

export const VoiceCaptureManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  captureId: z.uuid(),
  kind: z.enum(["wake-candidate", "debug-window"]),
  committedAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1).optional(),
  traceId: z
    .string()
    .regex(/^[a-f0-9]{32}$/u)
    .optional(),
  terminalOutcome: z.string().min(1),
  truncated: z.boolean(),
  truncationReason: z.string().min(1).optional(),
  audio: z.array(AudioObjectSchema),
  speakerMappings: z
    .array(
      z.strictObject({
        filename: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .optional(),
  wake: z
    .strictObject({
      detector: z.literal("sherpa"),
      phrase: z.string().min(1),
      score: z.number().nullable(),
      fragmentEndSeconds: z.number().nonnegative().nullable(),
      detectedAt: z.iso.datetime(),
      verifierAccepted: z.boolean().optional(),
      verifierScore: z.number().optional(),
      verifierLatencyMs: z.number().nonnegative().optional(),
    })
    .optional(),
  endpoint: z
    .strictObject({
      reason: z.string().min(1),
      sawSpeech: z.boolean(),
      sampleCount: z.number().int().nonnegative(),
      durationSeconds: z.number().nonnegative(),
      dtxSeconds: z.number().nonnegative(),
    })
    .optional(),
  transcript: z.string().nullable().optional(),
  normalizedCommand: z.string().nullable().optional(),
  tools: z.array(
    z.strictObject({
      name: z.string().min(1),
      arguments: z.unknown(),
      result: z.string().optional(),
      outcome: z.string().min(1),
      durationMs: z.number().nonnegative(),
    }),
  ),
  cloudOutcome: z.string().optional(),
  cloudUsage: z.unknown().optional(),
  reply: z
    .strictObject({
      outcome: z.string().min(1),
      packets: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      durationMs: z.number().nonnegative(),
    })
    .optional(),
  errors: z.array(
    z.strictObject({
      stage: z.string().min(1),
      class: z.string().min(1),
      message: z.string(),
    }),
  ),
});

export type VoiceCaptureManifest = z.infer<typeof VoiceCaptureManifestSchema>;
export type VoiceCaptureAudioObject = VoiceCaptureManifest["audio"][number];
