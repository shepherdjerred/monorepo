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
    // Per-guild persistent memory (MEMORY.md + logs/ + archived-memory/) lives
    // here. The driver overrides this to saves/<guildId>/goal-memory at runtime,
    // same as state_path/screenshot_dir, so memory survives restarts on the PVC.
    memory_dir: z.string().min(1).default("goal-memory"),
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
    // The goal bot is trusted/operator-driven and behind the authed control
    // server, so it gets higher input caps than casual Discord chat users (who
    // stay on game.commands.*). Bigger chords also cut LLM tool round-trips.
    command_limits: z
      .strictObject({
        max_quantity_per_action: z.number().int().positive().default(60),
        chord_max_commands: z.number().int().positive().default(32),
        chord_max_total: z.number().int().positive().default(200),
      })
      .default({
        max_quantity_per_action: 60,
        chord_max_commands: 32,
        chord_max_total: 200,
      }),
  })
  .default({
    enabled: false,
    model: "gpt-5.4-nano",
    codex_binary: "codex",
    runtime_directory: ".",
    screenshot_dir: "goal-screenshots",
    state_path: "goal-state.json",
    memory_dir: "goal-memory",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 30,
    lock_minutes: 5,
    progress_update_interval_seconds: 60,
    command_limits: {
      max_quantity_per_action: 60,
      chord_max_commands: 32,
      chord_max_total: 200,
    },
  });

export const ConfigSchema = z.strictObject({
  /**
   * @deprecated Pokemon is multi-tenant now — the active session's guildId comes from the
   * `/play` interaction, not config. Field stays optional so existing config.toml files
   * validate without churn; the runtime ignores it.
   */
  server_id: z
    .string()
    .regex(/\d*/, "IDs must only have numeric characters")
    .min(1)
    .optional(),
  /** Root directory under which per-guild session dirs are created. Defaults to "saves". */
  state_root_dir: z.string().min(1).default("saves"),
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
      /**
       * @deprecated Notifications now target the session's bound text channel (the channel
       * `/play` was invoked in). Field stays optional so existing config.toml files validate;
       * the runtime ignores it.
       */
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1)
        .optional(),
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
    /**
     * @deprecated The voice channel comes from the caller's voice state on `/play`.
     * Optional so existing config.toml files validate.
     */
    channel_id: z
      .string()
      .regex(/\d*/, "IDs must only have numeric characters")
      .min(1)
      .optional(),
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
      id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
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
    // Path to the built pokeemerald.wasm (built from source; see
    // scripts/build-wasm.sh and the Dagger image build in .dagger/src/image.ts).
    wasm_path: z.string().min(1),
    // Optional path for the persisted 128 KiB flash save.
    save_path: z.string().min(1).optional(),
    goal: GoalConfigSchema,
    commands: z.strictObject({
      enabled: z.boolean(),
      /**
       * @deprecated Text commands are now accepted in whatever text channel `/play`
       * was invoked in. Optional so existing config.toml files validate.
       */
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1)
        .optional(),
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
