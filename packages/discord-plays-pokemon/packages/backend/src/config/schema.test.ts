import { ConfigSchema } from "./schema.ts";

function validConfigWithoutGoal() {
  return {
    server_id: "1",
    bot: {
      enabled: true,
      discord_token: "token",
      application_id: "2",
      commands: {
        enabled: true,
        update: false,
        screenshot: {
          enabled: true,
        },
      },
      notifications: {
        channel_id: "3",
        enabled: true,
      },
    },
    stream: {
      enabled: true,
      channel_id: "4",
      dynamic_streaming: true,
      minimum_in_channel: 1,
      require_watching: true,
      userbot: {
        id: "5",
        token: "user-token",
      },
      video: {
        frame_rate: 30,
        bitrate_kbps: 1500,
        bitrate_max_kbps: 4000,
      },
    },
    game: {
      enabled: true,
      wasm_path: "pokeemerald.wasm",
      commands: {
        enabled: true,
        channel_id: "6",
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
        hold: {
          duration_in_milliseconds: 150,
        },
      },
    },
    web: {
      enabled: true,
      cors: true,
      port: 8081,
      assets: "packages/frontend/dist/",
      api: {
        enabled: true,
      },
    },
  };
}

describe("ConfigSchema goal config", () => {
  test("defaults goal mode off with bounded runtime settings", () => {
    const parsed = ConfigSchema.parse(validConfigWithoutGoal());
    expect(parsed.game.goal).toEqual({
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
    });
  });

  test("rejects goal runtime caps above 30 minutes", () => {
    const config = validConfigWithoutGoal();
    const result = ConfigSchema.safeParse({
      ...config,
      game: {
        ...config.game,
        goal: {
          max_runtime_minutes: 31,
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
