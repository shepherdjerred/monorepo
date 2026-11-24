/**
 * Building blocks for running a pinned Paper server in Docker. The-storm's E2E
 * harness and the harness's own sandboxes compose these; anything that knows
 * about a specific plugin's staging stays with its caller.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  assertNoPluginFailures,
  PAPER_DONE_PATTERN,
  PLUGIN_FAILURE_PATTERNS,
} from "#sandbox/paper-log.ts";
import { BOOT_TIMEOUT_MS } from "#sandbox/boot.ts";
import { DOCKER_CLI_TIMEOUT_MS, docker } from "./docker-cli.ts";
import { formatExpiresAtMs, LABELS, type SandboxRow } from "./rows.ts";

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

export async function seedSandboxContainer(options: {
  id: string;
  owner: string;
  expiresAtMs: number;
  containerId: string;
  dir: string;
  image: string;
  publishedStorm: boolean;
  hasMapSource: boolean;
  seedFiles: readonly { source: string; target: string }[];
}): Promise<void> {
  const slow = { timeoutMs: BOOT_TIMEOUT_MS };
  const helperLabels = [
    "--label",
    `${LABELS.sandbox}=${options.id}`,
    "--label",
    `${LABELS.expiresAt}=${formatExpiresAtMs(options.expiresAtMs)}`,
    "--label",
    `${LABELS.daemonPid}=${process.pid.toString()}`,
    "--label",
    `${LABELS.owner}=${options.owner}`,
    "--label",
    `${LABELS.keep}=false`,
  ];
  if (options.hasMapSource) {
    await docker(
      ["cp", path.join(options.dir, "world"), `${options.containerId}:/data/`],
      slow,
    );
  }
  if (options.publishedStorm) {
    // Match the server chart's fsGroup on a fresh volume, as boot-check.sh
    // does. The server itself stays unprivileged; only these short-lived
    // helpers touch the disposable volume before the first boot.
    for (const [command, value] of [
      ["chown", "1000:2000"],
      ["chmod", "2775"],
    ] as const) {
      await docker(
        [
          "run",
          "--rm",
          ...helperLabels,
          "--user",
          "0:0",
          "--volumes-from",
          options.containerId,
          "--entrypoint",
          command,
          options.image,
          value,
          "/data",
        ],
        slow,
      );
    }
  }
  for (const seed of options.seedFiles) {
    await docker(
      ["cp", seed.source, `${options.containerId}:/data/${seed.target}`],
      slow,
    );
  }
  if (options.hasMapSource) {
    const config = path.join(options.dir, "config");
    await mkdir(config, { mode: 0o777 });
    await Bun.write(
      path.join(config, "paper-global.yml"),
      "_version: 31\nproxies:\n  proxy-protocol: true\n",
    );
    await docker(["cp", config, `${options.containerId}:/data/`], slow);
    await docker(
      [
        "run",
        "--rm",
        ...helperLabels,
        "--volumes-from",
        options.containerId,
        "--entrypoint",
        "chmod",
        options.image,
        "-R",
        "a+rwX",
        "/data/config",
      ],
      slow,
    );
  }
}

export async function cleanupFailedSandboxBoot(options: {
  id: string;
  containerId: string;
  dir: string;
  listRows: () => Promise<readonly SandboxRow[]>;
}): Promise<void> {
  const fast = { timeoutMs: DOCKER_CLI_TIMEOUT_MS };
  const logs = await containerLogs(options.containerId).catch(() => "");
  await Bun.write(path.join(options.dir, "failed-boot.log"), logs);
  const rows = await options.listRows().catch(() => []);
  const targets = new Set([
    options.containerId,
    ...rows
      .filter((row) => row.id === options.id)
      .map((row) => row.containerId),
  ]);
  for (const target of targets) {
    try {
      await docker(["rm", "-f", "-v", target], fast);
    } catch {
      // Best-effort cleanup when creation or boot timed out before container registration.
    }
  }
}
