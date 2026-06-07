import { describe, expect, test } from "bun:test";
import {
  loadConfig,
  type EnvLookup,
} from "@shepherdjerred/streambot/config/index.ts";

const VALID: EnvLookup = {
  BOT_TOKEN: "bot-token",
  TOKEN: "user-token",
  GUILD_ID: "1337623164146155593",
  COMMAND_CHANNEL_ID: "1337631455085334650",
  VIDEO_CHANNEL_ID: "1337623164955398253",
  ADMIN_IDS: "160509172704739328, 160509172704739329",
  VIDEOS_DIR: "/home/bots/StreamBot/videos",
  MEDIA_DIRS: "/media/movies,/media/tv",
};

describe("loadConfig", () => {
  test("parses a valid environment and applies defaults", () => {
    const config = loadConfig(VALID);
    // Branded ids/tokens are structurally strings — compare via String().
    expect(String(config.discord.botToken)).toBe("bot-token");
    expect(String(config.discord.userToken)).toBe("user-token");
    expect(String(config.discord.statusChannelId)).toBe("1337631455085334650");
    expect(config.discord.adminIds.map(String)).toEqual([
      "160509172704739328",
      "160509172704739329",
    ]);
    expect(config.library.mediaDirs).toEqual(["/media/movies", "/media/tv"]);
    expect(config.library.extensions).toContain("mkv");
    expect(config.stream.width).toBe(1280);
    expect(config.stream.hardwareAcceleration).toBe(true);
    expect(config.stream.vaapiDevice).toBe("/dev/dri/renderD128");
    expect(config.idleTimeoutSeconds).toBe(300);
    expect(config.ytDlpPath).toBe("/usr/local/bin/yt-dlp");
  });

  test("throws when a required value is missing", () => {
    const env = { ...VALID };
    delete env["BOT_TOKEN"];
    expect(() => loadConfig(env)).toThrow("Invalid streambot configuration");
  });

  test("rejects a non-snowflake guild id", () => {
    expect(() =>
      loadConfig({ ...VALID, GUILD_ID: "not-a-snowflake" }),
    ).toThrow();
  });

  test("overrides numeric stream settings from the environment", () => {
    const config = loadConfig({
      ...VALID,
      STREAM_FPS: "60",
      STREAM_HARDWARE_ACCELERATION: "true",
    });
    expect(config.stream.fps).toBe(60);
    expect(config.stream.hardwareAcceleration).toBe(true);
  });

  test("defaults adminIds and mediaDirs to empty when unset", () => {
    const env = { ...VALID };
    delete env["ADMIN_IDS"];
    delete env["MEDIA_DIRS"];
    const config = loadConfig(env);
    expect(config.discord.adminIds).toEqual([]);
    expect(config.library.mediaDirs).toEqual([]);
  });

  test("defaults the resume-state config when unset", () => {
    const config = loadConfig(VALID);
    expect(config.state.dir).toBe("/state");
    expect(config.state.resumeMaxAgeSeconds).toBe(21_600);
  });

  test("reads STATE_DIR and RESUME_MAX_AGE_SECONDS from the environment", () => {
    const config = loadConfig({
      ...VALID,
      STATE_DIR: "/data/state",
      RESUME_MAX_AGE_SECONDS: "60",
    });
    expect(config.state.dir).toBe("/data/state");
    expect(config.state.resumeMaxAgeSeconds).toBe(60);
  });
});
