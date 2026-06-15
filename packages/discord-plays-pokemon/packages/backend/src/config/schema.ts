import { z } from "zod";

export type Config = z.infer<typeof ConfigSchema>;

const GoalConfigSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    model: z.string().min(1).default("gpt-5.4-nano"),
    codex_binary: z.string().min(1).default("codex"),
    runtime_directory: z.string().min(1).default("."),
    screenshot_dir: z.string().min(1).default("goal-screenshots"),
    state_path: z.string().min(1).default("goal-state.json"),
    control_host: z.string().min(1).default("127.0.0.1"),
    control_port: z.number().int().min(1024).max(49_151).default(8082),
    max_runtime_minutes: z.number().int().positive().max(30).default(30),
    lock_minutes: z.number().int().positive().max(30).default(5),
    progress_update_interval_seconds: z
      .number()
      .int()
      .positive()
      .max(600)
      .default(60),
  })
  .default({
    enabled: false,
    model: "gpt-5.4-nano",
    codex_binary: "codex",
    runtime_directory: ".",
    screenshot_dir: "goal-screenshots",
    state_path: "goal-state.json",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 30,
    lock_minutes: 5,
    progress_update_interval_seconds: 60,
  });

export const ConfigSchema = z.strictObject({
  server_id: z
    .string()
    .regex(/\d*/, "IDs must only have numeric characters")
    .min(1),
  bot: z.strictObject({
    enabled: z.boolean(),
    discord_token: z.string().min(1),
    application_id: z
      .string()
      .regex(/\d*/, "IDs must only have numeric characters")
      .min(1),
    commands: z.strictObject({
      enabled: z.boolean(),
      update: z.boolean(),
      screenshot: z.strictObject({
        enabled: z.boolean(),
      }),
    }),
    notifications: z.strictObject({
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      enabled: z.boolean(),
      // Notifications for in-game events detected by polling emulator memory
      // (faints, badges, evolutions, catches, ...). All defaulted so existing
      // config.toml files validate unchanged.
      events: z
        .strictObject({
          enabled: z.boolean().default(true),
          // "log" (shadow mode) detects + logs + counts events but sends
          // nothing to Discord; "send" posts to the notifications channel.
          mode: z.enum(["log", "send"]).default("send"),
          // How often to poll game memory. 30 frames ≈ 0.5s at ~60fps.
          poll_interval_frames: z.number().int().min(1).default(30),
          attach_screenshot: z.boolean().default(true),
          faint: z.boolean().default(true),
          badge: z.boolean().default(true),
          evolution: z.boolean().default(true),
          catch: z.boolean().default(true),
          whiteout: z.boolean().default(true),
          level_up: z.boolean().default(true),
          dex_entry: z.boolean().default(true),
        })
        // prefault (not default): an absent/`{}` events table is treated as
        // input so the per-field defaults above fill in. zod v4's .default()
        // would instead require the fully-parsed object.
        .prefault({}),
    }),
  }),
  stream: z.strictObject({
    enabled: z.boolean(),
    channel_id: z
      .string()
      .regex(/\d*/, "IDs must only have numeric characters")
      .min(1),
    dynamic_streaming: z.boolean(),
    minimum_in_channel: z.number().nonnegative(),
    require_watching: z.boolean(),
    // User IDs of peer userbots (other Go Live userbots that share this voice
    // channel — e.g. Glitter Kart, Streambot). Peer userbots are real Discord
    // user accounts, so `user.bot` is false for them; without this list they
    // would be counted as real viewers and keep this bot streaming forever.
    peer_userbot_ids: z
      .array(z.string().regex(/\d*/, "IDs must only have numeric characters"))
      .default([]),
    userbot: z.strictObject({
      id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      // Discord user (selfbot) token for the streaming account. Required
      // because Discord blocks video from bot tokens.
      token: z.string().min(1),
    }),
    video: z.strictObject({
      // @deprecated Superseded by the 16:9 letterbox (canvas_height + display
      // aspect). Retained, optional, so existing config.toml files still validate;
      // no longer read. Remove once all configs drop it.
      scale: z.number().int().min(1).max(6).optional(),
      frame_rate: z.number().positive(),
      bitrate_kbps: z.number().positive(),
      bitrate_max_kbps: z.number().positive(),
      // Height of the 16:9 output canvas sent to Discord (width derived as 16:9).
      // The 3:2 game is scaled to fit and pillarboxed onto black.
      canvas_height: z.number().int().positive().default(720),
      // VAAPI hardware H.264 encoding on an Intel iGPU. Off by default (software
      // libx264 fallback); also enableable via the STREAM_HARDWARE_ACCELERATION env.
      hardware_acceleration: z.boolean().default(false),
      vaapi_device: z.string().min(1).default("/dev/dri/renderD128"),
    }),
  }),
  game: z.strictObject({
    enabled: z.boolean(),
    // Path to the built pokeemerald.wasm (see scripts/fetch-wasm.ts).
    wasm_path: z.string().min(1),
    // Optional path for the persisted 128 KiB flash save.
    save_path: z.string().min(1).optional(),
    goal: GoalConfigSchema,
    commands: z.strictObject({
      enabled: z.boolean(),
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      max_actions_per_command: z.number().nonnegative(),
      max_quantity_per_action: z.number().nonnegative(),
      key_press_duration_in_milliseconds: z.number().nonnegative(),
      delay_between_actions_in_milliseconds: z.number().nonnegative(),
      burst: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
        delay_in_milliseconds: z.number().nonnegative(),
        quantity: z.number().nonnegative(),
      }),
      chord: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
        max_commands: z.number().nonnegative(),
        max_total: z.number().nonnegative(),
        delay: z.number().nonnegative(),
      }),
      hold: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
      }),
    }),
  }),
  web: z.strictObject({
    enabled: z.boolean(),
    cors: z.boolean(),
    port: z
      .number()
      .nonnegative()
      .min(1024, "Ports below 1024 are reserved")
      .max(49_151, "Ports above 49151 are reserved"),
    assets: z.string(),
    api: z.strictObject({
      enabled: z.boolean(),
    }),
  }),
});
