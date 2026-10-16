import { z } from "zod";
import { DriverFeedConfigSchema } from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";
import {
  botConfigFields,
  gameConfigRootFields,
  notificationsConfigFields,
  streamConfigFields,
  streamVideoConfigFields,
} from "@shepherdjerred/discord-plays-core/config/game-config.ts";

export type Config = z.infer<typeof ConfigSchema>;

const ReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);

const GoalConfigSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    model: z.string().min(1).default("gpt-5.6-sol"),
    // Codex `model_reasoning_effort` — medium is the goal-mode default so
    // navigation/vision turns retain the established reasoning baseline.
    reasoning_effort: ReasoningEffortSchema.default("medium"),
    runtime_directory: z.string().min(1).default("."),
    helper_dir: z.string().min(1).optional(),
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
    // Floor for audience-facing updates: if nothing was posted to Discord for
    // this long during a goal run, the harness composes and posts a status
    // line itself (location + recent actions + latest milestone). Should be
    // >= progress_update_interval_seconds; the floor holds either way.
    update_interval_seconds: z.number().int().min(30).max(600).default(90),
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
    model: "gpt-5.6-sol",
    reasoning_effort: "medium",
    runtime_directory: ".",
    screenshot_dir: "goal-screenshots",
    state_path: "goal-state.json",
    memory_dir: "goal-memory",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 30,
    lock_minutes: 5,
    progress_update_interval_seconds: 60,
    update_interval_seconds: 90,
    command_limits: {
      max_quantity_per_action: 60,
      chord_max_commands: 32,
      chord_max_total: 200,
    },
  });

export const ConfigSchema = z.strictObject({
  ...gameConfigRootFields,
  bot: z.strictObject({
    ...botConfigFields,
    notifications: z.strictObject({
      ...notificationsConfigFields,
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
    ...streamConfigFields,
    video: z.strictObject(streamVideoConfigFields),
  }),
  driver_feed: DriverFeedConfigSchema,
  game: z.strictObject({
    enabled: z.boolean(),
    // Path to the built pokeemerald.wasm (built from source; see
    // scripts/build-wasm.ts).
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

/** Game-session settings when the command bot and stream account are owned elsewhere. */
export const RuntimeConfigSchema = ConfigSchema.omit({ web: true }).extend({
  bot: ConfigSchema.shape.bot.pick({ notifications: true }),
  stream: ConfigSchema.shape.stream.omit({ userbot: true }),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
