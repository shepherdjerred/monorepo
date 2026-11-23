import { z } from "zod";

export const MAX_PUBLIC_REPLAY_BYTES = 512 * 1024 * 1024;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Playback admission is independent of whether the original file is stored. */
export const PublicReplayPlaybackSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    latestPatch: z.string(),
    package: z.strictObject({ url: z.string(), sha256: DigestSchema }),
  }),
  z.strictObject({
    status: z.literal("support_preparing"),
    latestPatch: z.string().nullable(),
    reason: z.enum(["patch_unobserved", "render_package_unavailable"]),
  }),
  z.strictObject({
    status: z.literal("incompatible"),
    latestPatch: z.string().nullable(),
    reason: z.enum([
      "older_patch",
      "unsupported_build",
      "unsupported_map",
      "unsupported_mode",
      "unsupported_roster",
      "unqualified_platform",
    ]),
  }),
  z.strictObject({ status: z.literal("metadata_pending") }),
]);

/** An explicit public projection: never serialize a database artifact row. */
export const PublicReplayDescriptorSchema = z.strictObject({
  replayId: z.uuid(),
  matchId: z.string().nullable(),
  platformId: z.string().nullable(),
  gameId: z.string().regex(/^\d{1,32}$/),
  bytes: z.number().int().positive().max(MAX_PUBLIC_REPLAY_BYTES),
  sha256: DigestSchema,
  gameBuild: z
    .string()
    .regex(/^\d+\.\d+\.\d+\.\d+$/)
    .nullable(),
  protocol: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  durationSeconds: z.number().positive().nullable(),
  mapId: z.number().int().positive().nullable(),
  gameMode: z.string().min(1).nullable(),
  teamSizes: z.array(z.number().int().positive()).min(1).max(20).nullable(),
  playback: PublicReplayPlaybackSchema,
});

export const PublicReplayAvailabilitySchema = z.strictObject({
  replay: PublicReplayDescriptorSchema.nullable(),
});

export type PublicReplayPlayback = z.infer<typeof PublicReplayPlaybackSchema>;
export type PublicReplayDescriptor = z.infer<
  typeof PublicReplayDescriptorSchema
>;
export type PublicReplayAvailability = z.infer<
  typeof PublicReplayAvailabilitySchema
>;
