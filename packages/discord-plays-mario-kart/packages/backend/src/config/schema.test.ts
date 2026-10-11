import { describe, expect, it } from "vitest";
import { engineFormat, N64WASM_FORMAT } from "#src/engine/format.ts";
import { ConfigSchema } from "./schema.ts";

/** The smallest config that satisfies every required field. */
function minimalConfig(): Record<string, unknown> {
  return {
    server_id: "1",
    bot: {
      enabled: false,
      discord_token: "token",
      application_id: "1",
      commands: {
        enabled: false,
        update: false,
        screenshot: { enabled: false },
      },
      notifications: { enabled: false },
    },
    stream: {
      enabled: true,
      dynamic_streaming: true,
      minimum_in_channel: 0,
      require_watching: false,
      userbot: { id: "1", token: "token" },
      video: {
        frame_rate: 30,
        bitrate_kbps: 5000,
        bitrate_max_kbps: 8000,
      },
    },
    emulator: { enabled: true, rom_path: "roms/mariokart64.z64" },
    web: {
      enabled: true,
      cors: true,
      port: 8081,
      assets: "packages/frontend/dist",
      api: { enabled: true },
    },
  };
}

describe("driver_feed config", () => {
  it("defaults the whole block when [driver_feed] is absent", () => {
    // Load-bearing: the live config.toml is a 1Password secret, so a required
    // section would crash-loop the pod until someone edited the vault.
    const parsed = ConfigSchema.parse(minimalConfig());

    expect(parsed.driver_feed.enabled).toBe(false);
    expect(parsed.driver_feed.height).toBe(480);
    expect(parsed.driver_feed.keyframe_interval_frames).toBe(30);
    expect(parsed.driver_feed.max_clients).toBe(8);
  });

  it("fills per-field defaults when the block is partially specified", () => {
    const parsed = ConfigSchema.parse({
      ...minimalConfig(),
      driver_feed: { enabled: true },
    });

    expect(parsed.driver_feed.enabled).toBe(true);
    expect(parsed.driver_feed.bitrate_kbps).toBe(2500);
  });

  it("rejects an unknown key rather than silently ignoring a typo", () => {
    expect(() =>
      ConfigSchema.parse({
        ...minimalConfig(),
        driver_feed: { enabled: true, bitrate: 2500 },
      }),
    ).toThrow();
  });

  it("rejects an output height outside the encodable range", () => {
    expect(() =>
      ConfigSchema.parse({ ...minimalConfig(), driver_feed: { height: 4320 } }),
    ).toThrow();
  });
});

describe("engine config", () => {
  it("keeps the wasm engine and its 640x240 frame when [spaghettikart] is absent", () => {
    // Same reason as [driver_feed]: the live config.toml lives in 1Password.
    const parsed = ConfigSchema.parse(minimalConfig());

    expect(parsed.emulator.engine).toBe("n64wasm");
    expect(parsed.spaghettikart).toEqual({
      install_dir: "packages/backend/assets/spaghettikart",
      output_fps: 30,
    });
    expect(engineFormat(parsed)).toEqual(N64WASM_FORMAT);
    expect(N64WASM_FORMAT).toMatchObject({
      width: 640,
      height: 240,
      rowScale: 1,
    });
  });

  it("delivers wasm frames at the configured emulator fps", () => {
    const parsed = ConfigSchema.parse({
      ...minimalConfig(),
      emulator: { enabled: true, rom_path: "rom.z64", fps: 24 },
    });

    expect(engineFormat(parsed).fps).toBe(24);
  });

  it("gives the native engine square 640x480 frames at its own rates", () => {
    const parsed = ConfigSchema.parse({
      ...minimalConfig(),
      emulator: { enabled: true, rom_path: "rom.z64", engine: "spaghettikart" },
      spaghettikart: { output_fps: 60 },
    });

    expect(engineFormat(parsed)).toEqual({
      width: 640,
      height: 480,
      rowScale: 2,
      fps: 60,
      audioSampleRate: 26_800,
    });
  });

  it("rejects an engine or output rate the bridge does not support", () => {
    expect(() =>
      ConfigSchema.parse({
        ...minimalConfig(),
        emulator: { enabled: true, rom_path: "rom.z64", engine: "mupen" },
      }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({
        ...minimalConfig(),
        spaghettikart: { output_fps: 45 },
      }),
    ).toThrow();
  });
});
