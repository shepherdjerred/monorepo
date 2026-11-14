import type { z } from "zod";
import type { MediaActor } from "./auth.ts";
import type {
  ImportPlaybackHistory,
  NowPlayingSchema,
  PlaybackHistorySchema,
  PlaybackQuery,
  PlaybackStatisticsSchema,
  SealPlaybackHandoff,
  PlaybackHandoffStatusSchema,
} from "#shared/household/playback.ts";

export type PlaybackHistoryApplication = {
  people: (actor: MediaActor) => Promise<{ id: string; displayName: string }[]>;
  history: (
    actor: MediaActor,
    query: PlaybackQuery,
  ) => Promise<z.infer<typeof PlaybackHistorySchema>>;
  nowPlaying: (actor: MediaActor) => Promise<z.infer<typeof NowPlayingSchema>>;
  statistics: (
    actor: MediaActor,
    query: PlaybackQuery,
  ) => Promise<z.infer<typeof PlaybackStatisticsSchema>>;
  importHistory: (
    actor: MediaActor,
    input: ImportPlaybackHistory,
  ) => Promise<{ imported: number; unchanged: number }>;
  sealHandoff: (
    actor: MediaActor,
    input: SealPlaybackHandoff,
  ) => Promise<{ version: number; collectionStartedAt: string }>;
  handoffStatus: (
    actor: MediaActor,
  ) => Promise<z.infer<typeof PlaybackHandoffStatusSchema>>;
};
