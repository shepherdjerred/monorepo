/**
 * Building blocks for running a pinned Paper server in Docker. The-storm's E2E
 * harness and the harness's own sandboxes compose these; anything that knows
 * about a specific plugin's staging stays with its caller.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  assertNoPluginFailures,
  PAPER_DONE_PATTERN,
  PLUGIN_FAILURE_PATTERNS,
} from "#sandbox/paper-log.ts";
import { docker } from "./docker-cli.ts";

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

export function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
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
