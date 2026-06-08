import { z } from "zod";
import {
  BotTokenSchema,
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  UserTokenSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

/**
 * Runtime configuration. Parsed once at boot from the process environment and never read
 * directly elsewhere — every consumer takes a validated {@link Config}. Ids and tokens are
 * branded (parsed, not cast) at this boundary.
 */
export const ConfigSchema = z.strictObject({
  discord: z.strictObject({
    /** Bot token for the command bot (discord.js) — handles slash commands. */
    botToken: BotTokenSchema,
    /** User token for the streamer (discord.js-selfbot-v13). */
    userToken: UserTokenSchema,
    guildId: GuildIdSchema,
    /** Channel where world-readable status is posted (now-playing, queue, shaming, …). */
    statusChannelId: ChannelIdSchema,
    /** Voice channel the streamer joins. */
    videoChannelId: ChannelIdSchema,
    /** User ids permitted to run admin commands (stop/clear, and skip/remove of others). */
    adminIds: z.array(UserIdSchema).default([]),
  }),
  library: z.strictObject({
    /** Writable directory scanned for ad-hoc videos. */
    videosDir: z.string().min(1),
    /** Read-only library roots (e.g. /media/movies, /media/tv). */
    mediaDirs: z.array(z.string().min(1)).default([]),
    /** Allowed video file extensions (lowercase, no dot). */
    extensions: z
      .array(z.string().min(1))
      .default(["mkv", "mp4", "webm", "avi", "mov", "m4v"]),
  }),
  stream: z.strictObject({
    width: z.number().int().positive().default(1280),
    height: z.number().int().positive().default(720),
    fps: z.number().int().positive().default(30),
    bitrateKbps: z.number().int().positive().default(2000),
    bitrateAudioKbps: z.number().int().positive().default(128),
    /** Use Intel VAAPI hardware encoding (falls back to software if the device is unavailable). */
    hardwareAcceleration: z.boolean().default(true),
    vaapiDevice: z.string().min(1).default("/dev/dri/renderD128"),
  }),
  /** Resume state: persisted playback so a restart (deploy/crash) picks up where it left off. */
  state: z
    .strictObject({
      /** Directory holding the resume-state file — a persistent volume in production. */
      dir: z.string().min(1).default("/state"),
      /** Ignore resume state older than this many seconds (don't resume a long-dead movie). */
      resumeMaxAgeSeconds: z.number().int().positive().default(21_600),
    })
    .default({ dir: "/state", resumeMaxAgeSeconds: 21_600 }),
  /** Optional TMDB integration for movie/TV poster art on the now-playing embed (local files). */
  tmdb: z.strictObject({ apiKey: z.string().min(1) }).optional(),
  /** Leave the voice channel after this many idle seconds. */
  idleTimeoutSeconds: z.number().int().positive().default(300),
  /** Maximum number of items to enqueue when expanding a playlist URL. */
  playlistLimit: z.number().int().positive().default(100),
  ytDlpPath: z.string().min(1).default("/usr/local/bin/yt-dlp"),
  ffmpegPath: z.string().min(1).default("ffmpeg"),
  /** Path to the `ffprobe` binary (chapter extraction for local files). */
  ffprobePath: z.string().min(1).default("ffprobe"),
});

export type Config = z.infer<typeof ConfigSchema>;
