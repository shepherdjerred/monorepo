import os from "node:os";
import { describe, expect, test } from "vitest";
import {
  HOMEBREW_ARM64_FFMPEG_FULL,
  HOMEBREW_INTEL_FFMPEG_FULL,
  buildDockerSmokeIntegrationCommand,
  buildLocalIntegrationCommand,
  candidateFfmpegPaths,
  defaultSpawnCommand,
  deriveFfprobePath,
  hasSubtitlesFilter,
  probeFfmpegFilters,
  resolveIntegrationPlan,
  runIntegration,
} from "#scripts/run-integration.ts";

const FILTERS_WITH_LIBASS = [
  "Filters:",
  "  T.. scale             V->V       Scale the input video size.",
  "  ... subtitles         V->V       Render text subtitles onto input video using the libass library.",
].join("\n");

const FILTERS_WITHOUT_LIBASS = [
  "Filters:",
  "  T.. scale             V->V       Scale the input video size.",
  "  ... drawbox           V->V       Draw a colored box on the input video.",
].join("\n");

describe("run-integration script", () => {
  test("orders FFMPEG_PATH, Homebrew ffmpeg-full, and PATH ffmpeg without duplicates", () => {
    expect(candidateFfmpegPaths({}, "darwin")).toEqual([
      HOMEBREW_ARM64_FFMPEG_FULL,
      HOMEBREW_INTEL_FFMPEG_FULL,
      "ffmpeg",
    ]);
    expect(
      candidateFfmpegPaths(
        { FFMPEG_PATH: HOMEBREW_ARM64_FFMPEG_FULL },
        "darwin",
      ),
    ).toEqual([
      HOMEBREW_ARM64_FFMPEG_FULL,
      HOMEBREW_INTEL_FFMPEG_FULL,
      "ffmpeg",
    ]);
    expect(
      candidateFfmpegPaths({ FFMPEG_PATH: "/custom/bin/ffmpeg" }, "linux"),
    ).toEqual(["/custom/bin/ffmpeg", "ffmpeg"]);
  });

  test("detects the libass subtitles filter in ffmpeg -filters output", () => {
    expect(hasSubtitlesFilter(FILTERS_WITH_LIBASS)).toBe(true);
    expect(hasSubtitlesFilter(FILTERS_WITHOUT_LIBASS)).toBe(false);
  });

  test("derives sibling ffprobe path unless FFPROBE_PATH is explicitly set", () => {
    expect(deriveFfprobePath(HOMEBREW_ARM64_FFMPEG_FULL, {})).toBe(
      "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
    );
    expect(deriveFfprobePath("ffmpeg", {})).toBe("ffprobe");
    expect(
      deriveFfprobePath(HOMEBREW_ARM64_FFMPEG_FULL, {
        FFPROBE_PATH: "/custom/ffprobe",
      }),
    ).toBe("/custom/ffprobe");
  });

  test("selects local Vitest execution when Homebrew ffmpeg-full has subtitles filter", async () => {
    const probed: string[] = [];
    const plan = await resolveIntegrationPlan({
      env: {},
      platform: "darwin",
      probeFilters: (candidate) => {
        probed.push(candidate);
        return Promise.resolve(
          candidate === HOMEBREW_ARM64_FFMPEG_FULL ? FILTERS_WITH_LIBASS : null,
        );
      },
    });

    expect(probed).toEqual([HOMEBREW_ARM64_FFMPEG_FULL]);
    expect(plan).toEqual({
      mode: "local",
      command: buildLocalIntegrationCommand(),
      env: {
        FFMPEG_PATH: HOMEBREW_ARM64_FFMPEG_FULL,
        FFPROBE_PATH: "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
      },
    });
  });

  test("falls back to Docker --target smoke on macOS when local ffmpeg lacks libass", async () => {
    const logs: string[] = [];
    let spawnedCmd: string[] = [];
    const exitCode = await runIntegration({
      env: { PATH: "/usr/bin" },
      platform: "darwin",
      probeFilters: () => Promise.resolve(FILTERS_WITHOUT_LIBASS),
      log: (msg) => logs.push(msg),
      spawnCommand: (cmd) => {
        spawnedCmd = cmd;
        return Promise.resolve(0);
      },
    });

    expect(exitCode).toBe(0);
    expect(spawnedCmd).toEqual(buildDockerSmokeIntegrationCommand());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("--target smoke");
  });

  test("runs local Vitest with forwarded extraArgs and env when supported", async () => {
    let spawnedCmd: string[] = [];
    let spawnedEnv: Record<string, string | undefined> = {};
    const exitCode = await runIntegration({
      env: { FFMPEG_PATH: "/opt/custom/ffmpeg" },
      platform: "linux",
      extraArgs: ["integration/subtitles.integration.test.ts"],
      probeFilters: () => Promise.resolve(FILTERS_WITH_LIBASS),
      spawnCommand: (cmd, env) => {
        spawnedCmd = cmd;
        spawnedEnv = env;
        return Promise.resolve(0);
      },
    });

    expect(exitCode).toBe(0);
    expect(spawnedCmd.at(-1)).toBe("integration/subtitles.integration.test.ts");
    expect(spawnedEnv["FFMPEG_PATH"]).toBe("/opt/custom/ffmpeg");
    expect(spawnedEnv["FFPROBE_PATH"]).toBe("/opt/custom/ffprobe");
  });

  test("fails fast on Linux when no ffmpeg has the subtitles filter", async () => {
    await expect(
      resolveIntegrationPlan({
        env: {},
        platform: "linux",
        probeFilters: () => Promise.resolve(FILTERS_WITHOUT_LIBASS),
      }),
    ).rejects.toThrow(/subtitles/);
  });

  test("probeFfmpegFilters handles missing, failing, and succeeding executables", async () => {
    expect(
      await probeFfmpegFilters("/nonexistent/streambot-missing-ffmpeg"),
    ).toBeNull();
    expect(await probeFfmpegFilters("false")).toBeNull();
    const echoed = await probeFfmpegFilters("echo");
    expect(echoed).toContain("-filters");
    expect(await defaultSpawnCommand(["true"], {}, os.tmpdir())).toBe(0);
  });
});
