import { describe, expect, it } from "vitest";
import { engineFormat } from "#src/engine/format.ts";
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
      auth: { public_origin: "https://mariokart.example.com" },
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
  it("defaults the native build when [spaghettikart] is absent", () => {
    // Same reason as [driver_feed]: the live config.toml lives in 1Password.
    const parsed = ConfigSchema.parse(minimalConfig());

    expect(parsed.spaghettikart).toEqual({
      install_dir: "packages/backend/assets/spaghettikart",
      output_fps: 30,
    });
    expect(engineFormat(parsed)).toEqual({
      width: 640,
      height: 480,
      rowScale: 2,
      fps: 30,
      audioSampleRate: 26_800,
    });
  });

  it("delivers frames at the configured output rate", () => {
    const parsed = ConfigSchema.parse({
      ...minimalConfig(),
      spaghettikart: { output_fps: 60 },
    });

    expect(engineFormat(parsed).fps).toBe(60);
  });

  it("still accepts the retired wasm emulator's settings", () => {
    // The live config.toml carries them; rejecting them would crash-loop the pod.
    const parsed = ConfigSchema.parse({
      ...minimalConfig(),
      emulator: {
        enabled: true,
        rom_path: "rom.z64",
        wasm_dir: "packages/backend/assets/n64wasm",
        fps: 30,
        software_render: true,
      },
    });

    expect(parsed.emulator.rom_path).toBe("rom.z64");
  });

  it("rejects an output rate the bridge does not support", () => {
    expect(() =>
      ConfigSchema.parse({
        ...minimalConfig(),
        spaghettikart: { output_fps: 45 },
      }),
    ).toThrow();
  });
});

function web(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...minimalConfig(),
    web: {
      enabled: true,
      cors: true,
      port: 8081,
      assets: "packages/frontend/dist",
      api: { enabled: true },
      auth: { public_origin: "https://mariokart.example.com" },
      ...overrides,
    },
  };
}

describe("web.auth config", () => {
  it("is required while the page's API is served", () => {
    expect(() => ConfigSchema.parse(web({ auth: undefined }))).toThrow(
      /web\.auth/u,
    );
  });

  it("is not needed with the API off", () => {
    expect(() =>
      ConfigSchema.parse(web({ auth: undefined, api: { enabled: false } })),
    ).not.toThrow();
  });

  it("takes a bare origin only", () => {
    expect(() =>
      ConfigSchema.parse(
        web({ auth: { public_origin: "https://mariokart.example.com/" } }),
      ),
    ).toThrow();
    expect(ConfigSchema.parse(web({})).web.auth?.public_origin).toBe(
      "https://mariokart.example.com",
    );
  });
});
