// The `config.toml` sections every Discord Plays game shares. Each game's own
// schema spreads these field sets into its strict objects and adds the rest,
// so a shared setting is defined, defaulted, and documented once.
import { z } from "zod";

export const DiscordIdSchema = z
  .string()
  .regex(/\d*/, "IDs must only have numeric characters")
  .min(1);

export const gameConfigRootFields = {
  /**
   * @deprecated Legacy single-tenant guild id. The active session's guild comes
   * from the `/play` interaction. Optional so existing config.toml files
   * validate; the runtime ignores it.
   */
  server_id: DiscordIdSchema.optional(),
  /** Root directory under which per-guild session dirs are created. */
  state_root_dir: z.string().min(1).default("saves"),
};

export const botConfigFields = {
  enabled: z.boolean(),
  discord_token: z.string().min(1),
  application_id: DiscordIdSchema,
  commands: z.strictObject({
    enabled: z.boolean(),
    update: z.boolean(),
    screenshot: z.strictObject({
      enabled: z.boolean(),
    }),
  }),
};

export const notificationsConfigFields = {
  /**
   * @deprecated Notifications target the session's bound text channel (the
   * channel `/play` was invoked in). Optional and ignored.
   */
  channel_id: DiscordIdSchema.optional(),
  enabled: z.boolean(),
};

export const streamConfigFields = {
  enabled: z.boolean(),
  /**
   * @deprecated The voice channel comes from the caller's voice state on
   * `/play`. Optional and ignored.
   */
  channel_id: DiscordIdSchema.optional(),
  dynamic_streaming: z.boolean(),
  minimum_in_channel: z.number().nonnegative(),
  require_watching: z.boolean(),
  /**
   * The selfbot account that joins voice channels and streams the game. ONE
   * userbot per deployment — the emulator is a single-slot resource (at most
   * one active game at a time per pod), so there's nothing to gain from a
   * pool of N userbots here. The account just needs to be a member of every
   * Discord server you want this deployment to serve.
   */
  userbot: z.strictObject({
    id: DiscordIdSchema,
    token: z.string().min(1),
  }),
};

export const streamVideoConfigFields = {
  // @deprecated Superseded by the 16:9 letterbox (canvas_height + display
  // aspect). Retained, optional, so existing config.toml files still validate;
  // no longer read. Remove once all configs drop it.
  scale: z.number().int().min(1).max(6).optional(),
  frame_rate: z.number().positive(),
  bitrate_kbps: z.number().positive(),
  bitrate_max_kbps: z.number().positive(),
  // Height of the 16:9 output canvas sent to Discord (width derived as 16:9).
  // The game is scaled to fit and pillarboxed onto black.
  canvas_height: z.number().int().positive().default(720),
  // VAAPI hardware H.264 encoding on an Intel iGPU. Off by default (software
  // libx264 fallback); also enableable via the STREAM_HARDWARE_ACCELERATION env.
  hardware_acceleration: z.boolean().default(false),
  vaapi_device: z.string().min(1).default("/dev/dri/renderD128"),
  // VAAPI `-async_depth`: encode-pipeline depth in frames. 1 (our default)
  // trades pipelining for ~one frame-interval less latency; set 2 to A/B
  // against ffmpeg's own default. VAAPI path only.
  encoder_async_depth: z.number().int().min(1).max(64).default(1),
};
