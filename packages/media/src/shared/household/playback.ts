import { z } from "zod";

export const PlaybackDecisionSchema = z.enum([
  "direct_play",
  "direct_stream",
  "transcode",
  "unknown",
]);
export const PlaybackStateSchema = z.enum([
  "playing",
  "paused",
  "buffering",
  "stopped",
]);
export const PlaybackSessionViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  seriesTitle: z.string().nullable(),
  mediaType: z.string(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  platform: z.string(),
  decision: PlaybackDecisionSchema,
  startedAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  watchedMs: z.number().int().nonnegative(),
  progressMs: z.number().int().nonnegative(),
  completed: z.boolean(),
  state: PlaybackStateSchema,
  source: z.enum(["plex", "tautulli"]),
});
export const PlaybackHistorySchema = z.object({
  items: z.array(PlaybackSessionViewSchema),
  nextCursor: z.string().nullable(),
});
export const PlaybackPeopleSchema = z.array(
  z.object({ id: z.string(), displayName: z.string() }),
);
export const NowPlayingSchema = z.object({
  observedAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
  items: z.array(PlaybackSessionViewSchema),
});
const RankingSchema = z.object({
  label: z.string(),
  plays: z.number().int().nonnegative(),
  watchedMs: z.number().int().nonnegative(),
});
export const PlaybackStatisticsSchema = z.object({
  plays: z.number().int().nonnegative(),
  watchedMs: z.number().int().nonnegative(),
  completedPlays: z.number().int().nonnegative(),
  topTitles: z.array(RankingSchema),
  topUsers: z.array(RankingSchema),
  topPlatforms: z.array(RankingSchema),
  decisions: z.array(
    z.object({
      decision: PlaybackDecisionSchema,
      plays: z.number().int().nonnegative(),
    }),
  ),
  minimumPlayMs: z.literal(120_000),
  completionPercent: z.literal(85),
});
export const PlaybackQuerySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    userId: z.string().min(1).optional(),
    search: z.string().max(200).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type PlaybackQuery = z.infer<typeof PlaybackQuerySchema>;

// The importer consumes normalized, ungrouped historical rows, never credentials.
export const TautulliHistoryRowSchema = z
  .object({
    id: z
      .union([z.string().min(1), z.number().int().nonnegative()])
      .transform(String),
    user_id: z
      .union([z.string().min(1), z.number().int().nonnegative()])
      .transform(String),
    rating_key: z
      .union([z.string().min(1), z.number().int().nonnegative()])
      .transform(String),
    started: z.number().int().positive(),
    stopped: z.number().int().positive(),
    duration: z.number().int().nonnegative(), // actual watched seconds, excludes pause
    percent_complete: z.number().min(0).max(100), // preserve source's reporting semantics, not watched truth
    full_title: z.string().min(1).max(1000),
    grandparent_title: z.string().max(1000).nullable().default(null),
    media_type: z.string().min(1).max(64),
    platform: z.string().max(256),
    player: z.string().max(256),
    transcode_decision: PlaybackDecisionSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.stopped >= row.started && row.duration <= row.stopped - row.started,
    "Invalid historical session interval",
  );
export const ImportPlaybackHistorySchema = z
  .object({
    sourceInstanceId: z.string().min(1).max(256),
    serverMachineId: z.string().min(1).max(256),
    through: z.iso.datetime(),
    rows: z.array(TautulliHistoryRowSchema).max(1000),
    userBindings: z
      .array(
        z
          .object({
            sourceUserId: z.string().min(1),
            userId: z.uuid(),
            plexAccountId: z.string().min(1),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type ImportPlaybackHistory = z.infer<typeof ImportPlaybackHistorySchema>;
export const SealPlaybackHandoffSchema = z
  .object({
    sourceInstanceId: z.string().min(1).max(256),
    through: z.iso.datetime(),
    expectedVersion: z.number().int().nonnegative(),
    expectedSessions: z.number().int().nonnegative(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    quiescenceCapturedAt: z.iso.datetime(),
    inventoryDigest: z.string().min(1),
  })
  .strict();
export type SealPlaybackHandoff = z.infer<typeof SealPlaybackHandoffSchema>;
export type PlaybackHandoffEvidence = {
  capturedAt: Date;
  expiresAt: Date;
  inventoryDigest: string;
};
export const PlaybackHandoffStatusSchema = z.object({
  version: z.number().int().nonnegative(),
  sourceInstanceId: z.string().nullable(),
  importedThrough: z.iso.datetime().nullable(),
  collectionStartedAt: z.iso.datetime().nullable(),
  sessions: z.number().int().nonnegative(),
  snapshotDigest: z.string().nullable(),
});

export type PlaybackActivities = {
  reconcileMediaPlayback: () => Promise<{
    observed: number;
    completed: number;
  }>;
  reconcileMediaRequestInterests: () => Promise<{
    nextCursor: string | null;
    processed: number;
  }>;
};
