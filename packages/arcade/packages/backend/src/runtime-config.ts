import path from "node:path";
import { z } from "zod";
import {
  ConfigSchema as Mk64Schema,
  RuntimeConfigSchema as Mk64RuntimeSchema,
} from "@discord-plays-mario-kart/backend/config/schema.ts";
import {
  ConfigSchema as EmeraldSchema,
  RuntimeConfigSchema as EmeraldRuntimeSchema,
} from "@discord-plays-pokemon/backend/config/schema.ts";
import { DriverFeedConfigSchema } from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";

export const RuntimeSettingsSchema = z.strictObject({
  streamVideo: Mk64Schema.shape.stream.shape.video,
  emeraldStreamVideo: EmeraldSchema.shape.stream.shape.video,
  driverFeed: DriverFeedConfigSchema,
  mk64OutputFps: z.union([z.literal(30), z.literal(60)]),
  mk64OverlayEnabled: z.boolean(),
  mk64PollEveryNFrames:
    Mk64Schema.shape.leaderboard.unwrap().shape.poll_every_n_frames,
  emeraldNotifications: EmeraldSchema.shape.bot.shape.notifications,
  emeraldCommands: EmeraldSchema.shape.game.shape.commands,
  emeraldGoal: EmeraldSchema.shape.game.shape.goal,
});
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;

export const runtimeDefaults = RuntimeSettingsSchema.parse({
  streamVideo: { frame_rate: 30, bitrate_kbps: 5000, bitrate_max_kbps: 8000 },
  emeraldStreamVideo: {
    frame_rate: 30,
    bitrate_kbps: 1500,
    bitrate_max_kbps: 4000,
  },
  driverFeed: {},
  mk64OutputFps: 30,
  mk64OverlayEnabled: true,
  mk64PollEveryNFrames: 10,
  emeraldNotifications: { enabled: true },
  emeraldCommands: {
    enabled: true,
    max_actions_per_command: 20,
    max_quantity_per_action: 10,
    key_press_duration_in_milliseconds: 15,
    delay_between_actions_in_milliseconds: 5,
    burst: {
      duration_in_milliseconds: 15,
      delay_in_milliseconds: 5,
      quantity: 3,
    },
    chord: {
      duration_in_milliseconds: 15,
      max_commands: 10,
      max_total: 10,
      delay: 5,
    },
    hold: { duration_in_milliseconds: 150 },
  },
  emeraldGoal: {},
});

/** Adapt session settings without exposing command-bot or streaming credentials. */
export function createRuntimeConfigs(options: {
  settings: RuntimeSettings;
  stateRoot: string;
  assets: string;
  databasePath: string;
}) {
  const { settings, stateRoot, assets, databasePath } = options;
  const mk64Root = path.resolve(
    import.meta.dirname,
    "../../../../discord-plays-mario-kart",
  );
  const emeraldRoot = path.resolve(
    import.meta.dirname,
    "../../../../discord-plays-pokemon",
  );
  const stream = {
    enabled: true,
    dynamic_streaming: true,
    minimum_in_channel: 1,
  };
  return {
    mk64: Mk64RuntimeSchema.parse({
      state_root_dir: path.join(stateRoot, "mk64"),
      stream: {
        ...stream,
        require_watching: false,
        video: settings.streamVideo,
      },
      emulator: {
        enabled: true,
        rom_path: path.join(assets, "mk64", "rom.z64"),
        seats: 4,
      },
      spaghettikart: {
        install_dir: path.join(
          mk64Root,
          "packages/backend/assets/spaghettikart",
        ),
        output_fps: settings.mk64OutputFps,
      },
      leaderboard: {
        enabled: true,
        db_path: databasePath,
        overlay_enabled: settings.mk64OverlayEnabled,
        poll_every_n_frames: settings.mk64PollEveryNFrames,
      },
      driver_feed: settings.driverFeed,
    }),
    emerald: EmeraldRuntimeSchema.parse({
      state_root_dir: path.join(stateRoot, "emerald"),
      bot: { notifications: settings.emeraldNotifications },
      stream: {
        ...stream,
        require_watching: true,
        video: settings.emeraldStreamVideo,
      },
      game: {
        enabled: true,
        wasm_path: path.join(assets, "emerald", "pokeemerald.wasm"),
        goal: {
          ...settings.emeraldGoal,
          runtime_directory: emeraldRoot,
          helper_dir: path.join(stateRoot, "emerald", ".goal-bin"),
        },
        commands: settings.emeraldCommands,
      },
      driver_feed: settings.driverFeed,
    }),
  };
}
