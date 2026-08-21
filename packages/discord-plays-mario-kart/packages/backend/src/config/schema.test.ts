import { describe, expect, it } from "vitest";
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
