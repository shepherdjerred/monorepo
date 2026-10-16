import { ConfigSchema, type Config } from "#src/config/schema.ts";
import { gameCommandDefaults } from "#src/config/game-command-defaults.ts";

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
      commands: gameCommandDefaults,
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
