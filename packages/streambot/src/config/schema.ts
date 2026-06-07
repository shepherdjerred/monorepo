import { z } from "zod";

/** A Discord snowflake id (guild / channel / user). */
const Snowflake = z
  .string()
  .regex(/^\d{17,20}$/u, "must be a Discord snowflake (17-20 digits)");

/**
 * Runtime configuration. Parsed once at boot from the process environment and never read
 * directly elsewhere — every consumer takes a validated {@link Config}.
 */
export const ConfigSchema = z.strictObject({
  discord: z.strictObject({
    /** Bot token for the command bot (discord.js). */
    botToken: z.string().min(1),
    /** User token for the streamer (discord.js-selfbot-v13). */
    userToken: z.string().min(1),
    guildId: Snowflake,
    /** Text channel the command bot listens in. */
    commandChannelId: Snowflake,
    /** Voice channel the streamer joins. */
    videoChannelId: Snowflake,
    /** User ids permitted to run admin commands. */
    adminIds: z.array(Snowflake).default([]),
    /** Command prefix for text commands. */
    prefix: z.string().min(1).default("$"),
  }),
  library: z.strictObject({
    /** Writable directory for uploaded videos. */
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
    hardwareAcceleration: z.boolean().default(false),
  }),
  ytDlpPath: z.string().min(1).default("/usr/local/bin/yt-dlp"),
  ffmpegPath: z.string().min(1).default("ffmpeg"),
});

export type Config = z.infer<typeof ConfigSchema>;
