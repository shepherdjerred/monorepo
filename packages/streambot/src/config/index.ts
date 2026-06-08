import { z } from "zod";
import {
  ConfigSchema,
  type Config,
} from "@shepherdjerred/streambot/config/schema.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/** Environment lookup. Defaults to {@link Bun.env}; injectable for tests. */
export type EnvLookup = Record<string, string | undefined>;

function list(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.toLowerCase() === "true";
}

/**
 * Build the raw config object from environment variables and validate it with Zod. Throws with
 * a readable, aggregated message if the environment is misconfigured (fail fast at the boundary).
 */
export function loadConfig(env: EnvLookup = Bun.env): Config {
  const raw = {
    discord: {
      botToken: env["BOT_TOKEN"],
      userToken: env["TOKEN"],
      guildId: env["GUILD_ID"],
      // The configured channel is where world-readable output is posted; commands work anywhere.
      statusChannelId: env["COMMAND_CHANNEL_ID"],
      videoChannelId: env["VIDEO_CHANNEL_ID"],
      adminIds: list(env["ADMIN_IDS"]),
    },
    library: {
      videosDir: env["VIDEOS_DIR"],
      mediaDirs: list(env["MEDIA_DIRS"]),
      extensions: list(env["VIDEO_EXTENSIONS"]),
    },
    stream: {
      width: num(env["STREAM_WIDTH"]),
      height: num(env["STREAM_HEIGHT"]),
      fps: num(env["STREAM_FPS"]),
      bitrateKbps: num(env["STREAM_BITRATE_KBPS"]),
      bitrateAudioKbps: num(env["STREAM_BITRATE_AUDIO_KBPS"]),
      hardwareAcceleration: bool(env["STREAM_HARDWARE_ACCELERATION"]),
      vaapiDevice: env["VAAPI_DEVICE"],
    },
    state: {
      dir: env["STATE_DIR"],
      resumeMaxAgeSeconds: num(env["RESUME_MAX_AGE_SECONDS"]),
    },
    idleTimeoutSeconds: num(env["IDLE_TIMEOUT_SECONDS"]),
    playlistLimit: num(env["PLAYLIST_LIMIT"]),
    ytDlpPath: env["YT_DLP_PATH"],
    ffmpegPath: env["FFMPEG_PATH"],
    ffprobePath: env["FFPROBE_PATH"],
    observability: {
      metricsPort: num(env["METRICS_PORT"]),
    },
  };

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = z.flattenError(parsed.error);
    logger.error("Invalid streambot configuration", { issues });
    throw new Error("Invalid streambot configuration", { cause: parsed.error });
  }
  return parsed.data;
}
