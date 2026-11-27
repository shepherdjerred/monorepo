#!/usr/bin/env bun
/**
 * Runs Streambot's real-FFmpeg integration suite (`integration/`).
 *
 * Homebrew `ffmpeg` 9+ on macOS omits `libass` (`subtitles` filter), moving it
 * to keg-only `ffmpeg-full`. This runner probes `FFMPEG_PATH`, Homebrew's
 * `ffmpeg-full`, and `PATH` `ffmpeg` via `ffmpeg -filters` for `subtitles`:
 * - When supported locally, runs Vitest directly with `FFMPEG_PATH` +
 *   `FFPROBE_PATH` pointed at the validated installation.
 * - On macOS without `libass`, falls back to building the repository
 *   `Dockerfile`'s `--target smoke` stage (which executes all 27 real-FFmpeg
 *   integration tests inside the Linux runtime without skipping assertions).
 */
import path from "node:path";

export type EnvRecord = Record<string, string | undefined>;

export type IntegrationPlan =
  | {
      mode: "local";
      command: string[];
      env: { FFMPEG_PATH: string; FFPROBE_PATH: string };
    }
  | {
      mode: "docker-smoke";
      command: string[];
    };

export const HOMEBREW_ARM64_FFMPEG_FULL =
  "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";
export const HOMEBREW_INTEL_FFMPEG_FULL =
  "/usr/local/opt/ffmpeg-full/bin/ffmpeg";

export function candidateFfmpegPaths(
  env: EnvRecord,
  platform: NodeJS.Platform,
): string[] {
  const candidates: string[] = [];
  const configured = env["FFMPEG_PATH"];
  if (configured !== undefined && configured !== "") {
    candidates.push(configured);
  }
  if (platform === "darwin") {
    candidates.push(HOMEBREW_ARM64_FFMPEG_FULL, HOMEBREW_INTEL_FFMPEG_FULL);
  }
  candidates.push("ffmpeg");
  return [...new Set(candidates)];
}

export function hasSubtitlesFilter(filtersOutput: string): boolean {
  return /\bsubtitles\s+V->V\b/u.test(filtersOutput);
}

export function deriveFfprobePath(ffmpegPath: string, env: EnvRecord): string {
  const configured = env["FFPROBE_PATH"];
  if (configured !== undefined && configured !== "") {
    return configured;
  }
  const dir = path.dirname(ffmpegPath);
  return dir === "." ? "ffprobe" : path.join(dir, "ffprobe");
}

export function buildLocalIntegrationCommand(
  extraArgs: readonly string[] = [],
): string[] {
  const targets = extraArgs.length > 0 ? [...extraArgs] : ["integration/"];
  return [
    "bun",
    "--no-install",
    "--bun",
    "vitest",
    "--config",
    "../../vitest.config.ts",
    "run",
    "--testTimeout",
    "120000",
    ...targets,
  ];
}

export function buildDockerSmokeIntegrationCommand(): string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--target",
    "smoke",
    "-f",
    "Dockerfile",
    "../..",
  ];
}

export async function probeFfmpegFilters(
  ffmpegPath: string,
): Promise<string | null> {
  try {
    const proc = Bun.spawn([ffmpegPath, "-hide_banner", "-filters"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return exitCode === 0 ? stdout : null;
  } catch {
    return null;
  }
}

export async function resolveIntegrationPlan(options: {
  env: EnvRecord;
  platform: NodeJS.Platform;
  extraArgs?: readonly string[];
  probeFilters?: (ffmpegPath: string) => Promise<string | null>;
}): Promise<IntegrationPlan> {
  const probe = options.probeFilters ?? probeFfmpegFilters;
  const candidates = candidateFfmpegPaths(options.env, options.platform);

  for (const candidate of candidates) {
    const filters = await probe(candidate);
    if (filters !== null && hasSubtitlesFilter(filters)) {
      return {
        mode: "local",
        command: buildLocalIntegrationCommand(options.extraArgs),
        env: {
          FFMPEG_PATH: candidate,
          FFPROBE_PATH: deriveFfprobePath(candidate, options.env),
        },
      };
    }
  }

  if (options.platform === "darwin") {
    return {
      mode: "docker-smoke",
      command: buildDockerSmokeIntegrationCommand(),
    };
  }

  throw new Error(
    `No ffmpeg binary with the 'subtitles' (libass) filter was found in [${candidates.join(", ")}]. Install ffmpeg with libass support to run Streambot integration tests.`,
  );
}

export async function defaultSpawnCommand(
  command: string[],
  spawnEnv: EnvRecord,
  cwd: string,
): Promise<number> {
  const proc = Bun.spawn(command, {
    cwd,
    env: spawnEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

export async function runIntegration(options?: {
  env?: EnvRecord;
  platform?: NodeJS.Platform;
  extraArgs?: readonly string[];
  probeFilters?: (ffmpegPath: string) => Promise<string | null>;
  spawnCommand?: (
    command: string[],
    env: EnvRecord,
    cwd: string,
  ) => Promise<number>;
  log?: (message: string) => void;
}): Promise<number> {
  const env = options?.env ?? Bun.env;
  const platform = options?.platform ?? process.platform;
  const extraArgs = options?.extraArgs ?? Bun.argv.slice(2);
  const log = options?.log ?? console.info;
  const packageDir = path.resolve(import.meta.dir, "..");

  const plan = await resolveIntegrationPlan({
    env,
    platform,
    extraArgs,
    ...(options?.probeFilters === undefined
      ? {}
      : { probeFilters: options.probeFilters }),
  });

  if (plan.mode === "docker-smoke") {
    log(
      "Local ffmpeg lacks the 'subtitles' (libass) filter; running full integration suite via Docker '--target smoke' (install Homebrew 'ffmpeg-full' for native macOS execution).",
    );
  }

  const childEnv: EnvRecord =
    plan.mode === "local" ? { ...env, ...plan.env } : { ...env };

  const execute = options?.spawnCommand ?? defaultSpawnCommand;
  return await execute(plan.command, childEnv, packageDir);
}

if (import.meta.main) {
  const exitCode = await runIntegration();
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
