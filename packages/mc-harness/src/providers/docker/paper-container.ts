/**
 * Building blocks for running a pinned Paper server in Docker. The-storm's E2E
 * harness and the harness's own sandboxes compose these; anything that knows
 * about a specific plugin's staging stays with its caller.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { paper, type PluginPin } from "#src/pins.ts";
import { docker } from "./docker-cli.ts";

/** Paper's console line once the server accepts connections. */
export const PAPER_DONE_PATTERN = /Done \(\d+\.\d+s\)! For help/u;

/** Console lines that mean a plugin failed to start; the server keeps running. */
export const PLUGIN_FAILURE_PATTERNS: readonly string[] = [
  "Error occurred while enabling",
  "Could not load 'plugins/",
];

/**
 * Warm-cache mounts, host dir under the cache -> container path, for
 * Paperclip's patched Mojang jar and libraries.
 */
export const warmMounts = [
  ["paperclip/cache", "/data/cache"],
  ["paperclip/libraries", "/data/libraries"],
  ["paperclip/versions", "/data/versions"],
] as const;

export function warmMountArgs(cacheDir: string): string[] {
  return warmMounts.flatMap(([dir, target]) => [
    "-v",
    `${path.join(cacheDir, dir)}:${target}`,
  ]);
}

/** File name the itzg image looks for before downloading Paper itself. */
export const paperJarName = `paper-${paper.version}-${paper.build.toString()}.jar`;

/**
 * Bukkit throttles reconnects from one address for 4s by default, which breaks
 * back-to-back joins from a test runner on the same host.
 */
export async function writeThrottleFreeBukkitYml(file: string): Promise<void> {
  await Bun.write(file, "settings:\n  connection-throttle: -1\n");
  await chmod(file, 0o666);
}

/**
 * The environment every disposable Paper server shares: pinned version,
 * offline mode (no Microsoft auth for local clients), a cheap peaceful world,
 * and no third-party default downloads so boot stays hermetic.
 */
export function basePaperEnv(): Record<string, string> {
  return {
    EULA: "TRUE",
    TYPE: "PAPER",
    VERSION: paper.version,
    PAPER_BUILD: paper.build.toString(),
    ONLINE_MODE: "FALSE",
    SKIP_DOWNLOAD_DEFAULTS: "true",
    MEMORY: "1G",
    LEVEL_TYPE: "minecraft:flat",
    GENERATE_STRUCTURES: "false",
    SPAWN_PROTECTION: "0",
    DIFFICULTY: "peaceful",
    MODE: "survival",
    VIEW_DISTANCE: "4",
    SIMULATION_DISTANCE: "4",
    ENABLE_AUTOPAUSE: "false",
  };
}

export function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status.toString()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Downloads once into the cache and verifies the pinned sha256 on every run. */
export async function ensureArtifact(
  file: string,
  pin: Pick<PluginPin, "url" | "sha256">,
): Promise<void> {
  const cached = Bun.file(file);
  const exists = await cached.exists();
  const bytes = exists
    ? new Uint8Array(await cached.arrayBuffer())
    : await download(pin.url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pin.sha256) {
    throw new Error(
      `${path.basename(file)} sha256 mismatch: expected ${pin.sha256}, got ${actual}`,
    );
  }
  if (!exists) {
    await Bun.write(file, bytes);
  }
}

/** Copies each pinned jar (downloaded once into `downloadsDir`) into `pluginsDir`. */
export async function stagePinnedPlugins(
  downloadsDir: string,
  pluginsDir: string,
  pins: readonly Pick<PluginPin, "name" | "version" | "url" | "sha256">[],
): Promise<void> {
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true, mode: 0o700 });
  for (const pin of pins) {
    const jar = `${pin.name}-${pin.version}.jar`;
    await ensureArtifact(path.join(downloadsDir, jar), pin);
    await Bun.write(
      path.join(pluginsDir, jar),
      Bun.file(path.join(downloadsDir, jar)),
    );
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes containers carrying `ownerLabel` whose `pidLabel` process no longer
 * exists, and the matching per-pid staging dirs under `runsDir`.
 */
export async function reapPidOwnedContainers(options: {
  ownerLabel: string;
  pidLabel: string;
  runsDir: string;
}): Promise<void> {
  const { stdout } = await docker([
    "ps",
    "-a",
    "--filter",
    `label=${options.ownerLabel}`,
    "--format",
    `{{.ID}} {{.Label "${options.pidLabel}"}}`,
  ]);
  for (const entry of stdout.split("\n").filter(Boolean)) {
    const [id = "", pid = ""] = entry.split(" ");
    if (!isAlive(Number(pid))) {
      await docker(["rm", "-f", "-v", id]);
    }
  }
  for (const pid of await readdir(options.runsDir)) {
    if (!isAlive(Number(pid))) {
      await rm(path.join(options.runsDir, pid), {
        recursive: true,
        force: true,
      });
    }
  }
}

const PortBindingSchema = z
  .string()
  .trim()
  .regex(/^[\d.]+:\d+$/u)
  .transform((binding) => {
    const [host = "", port = ""] = binding.split(":");
    return { host, port: Number(port) };
  });

/** Parses `docker port` output; the IPv4 loopback binding is listed first. */
export function parsePortBinding(stdout: string): {
  host: string;
  port: number;
} {
  return PortBindingSchema.parse(stdout.split("\n")[0]);
}

export async function publishedPort(
  containerId: string,
  port: number,
): Promise<{ host: string; port: number }> {
  const { stdout } = await docker([
    "port",
    containerId,
    `${port.toString()}/tcp`,
  ]);
  return parsePortBinding(stdout);
}

export async function containerLogs(
  containerId: string,
  tail?: number,
): Promise<string> {
  const { stdout, stderr } = await docker([
    "logs",
    ...(tail === undefined ? [] : ["--tail", tail.toString()]),
    containerId,
  ]);
  return stderr.length > 0 ? `${stdout}\n${stderr}` : stdout;
}

export async function waitForLog(
  containerId: string,
  pattern: RegExp,
  deadline: number,
): Promise<void> {
  for (;;) {
    const { stdout, stderr } = await docker(["logs", containerId]);
    if (pattern.test(stdout) || pattern.test(stderr)) {
      return;
    }
    const tail = `${stdout.slice(-4000)}\n${stderr.slice(-4000)}`;
    const { stdout: state } = await docker([
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerId,
    ]);
    if (state.trim() !== "true") {
      throw new Error(`Server exited before ready:\n${tail}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Server not ready before deadline:\n${tail}`);
    }
    await Bun.sleep(500);
  }
}

/** Throws with the log tail when any failure pattern appears in the console. */
export function assertNoPluginFailures(
  logs: string,
  patterns: readonly string[] = PLUGIN_FAILURE_PATTERNS,
): void {
  const hit = patterns.find((pattern) => logs.includes(pattern));
  if (hit !== undefined) {
    throw new Error(
      `Server plugin startup failed (${hit}):\n${logs.slice(-12_000)}`,
    );
  }
}

/** Starts a created container and waits for Paper's Done line. */
export async function startAndAwaitDone(
  containerId: string,
  deadline: number,
  failurePatterns: readonly string[] = PLUGIN_FAILURE_PATTERNS,
): Promise<void> {
  await docker(["start", containerId]);
  await waitForLog(containerId, PAPER_DONE_PATTERN, deadline);
  assertNoPluginFailures(await containerLogs(containerId), failurePatterns);
}
