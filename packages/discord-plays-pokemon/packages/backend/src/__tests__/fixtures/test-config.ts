import { ConfigSchema, type Config } from "#src/config/schema.ts";

/** A complete, valid config for tests: no Discord, no web server, no goal. */
export function testConfig(goalEnabled = false): Config {
  return ConfigSchema.parse({
    bot: {
      enabled: true,
      discord_token: "token",
      application_id: "2",
      commands: { enabled: true, update: false, screenshot: { enabled: true } },
      notifications: { enabled: false },
    },
    stream: {
      enabled: true,
      dynamic_streaming: true,
      minimum_in_channel: 1,
      require_watching: true,
      userbot: { id: "5", token: "user-token" },
      video: { frame_rate: 30, bitrate_kbps: 1500, bitrate_max_kbps: 4000 },
    },
    game: {
      enabled: true,
      wasm_path: "pokeemerald.wasm",
      commands: {
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
      goal: { enabled: goalEnabled },
    },
    web: {
      enabled: false,
      cors: false,
      port: 8081,
      assets: "dist/",
      api: { enabled: false },
    },
  });
}
