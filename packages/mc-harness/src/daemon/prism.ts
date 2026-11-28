import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CLIENT_PROJECT } from "#protocol/paths.ts";

const INSTANCE = "StormControl";
const MARKER = "storm-control-owned";

export const AUTOMATED_CLIENT_OPTIONS_TXT =
  'onboardAccessibility:false\ntutorialStep:none\nenableVsync:false\nmaxFps:120\npauseOnLostFocus:false\ninactivityFpsLimit:"minimized"\n';

export function prismControlInstanceName(
  clientName: string,
  shortId: string = randomUUID().slice(0, 8),
): string {
  const slug = clientName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 24)
    .replaceAll(/-+$/gu, "");
  const cleanId = shortId.replaceAll(/[^a-z0-9]+/giu, "").slice(0, 12);
  return `storm-control-${slug.length > 0 ? slug : "client"}-${cleanId.length > 0 ? cleanId : "session"}`;
}

export function prismControlLaunchArgs(
  launcher: string,
  instanceName: string,
  profileName: string,
): string[] {
  return [launcher, "--launch", instanceName, "--profile", profileName];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Copies logs, crash reports, and instance metadata into `destinationDir` before removing a temporary Prism instance. */
export async function copyPrismDiagnostics(
  instanceDir: string,
  destinationDir: string,
): Promise<void> {
  if (!(await exists(instanceDir))) return;
  const candidates: readonly [string, string][] = [
    [path.join(instanceDir, "minecraft", "logs"), "logs"],
    [path.join(instanceDir, "minecraft", "crash-reports"), "crash-reports"],
    [path.join(instanceDir, "instance.cfg"), "instance.cfg"],
    [path.join(instanceDir, "mmc-pack.json"), "mmc-pack.json"],
  ];
  let createdDestination = false;
  for (const [source, relativeTarget] of candidates) {
    if (!(await exists(source))) continue;
    if (!createdDestination) {
      await mkdir(destinationDir, { recursive: true, mode: 0o700 });
      createdDestination = true;
    }
    await cp(source, path.join(destinationDir, relativeTarget), {
      recursive: true,
    });
  }
}

/** Prepare a dedicated instance; Prism retains and uses its own signed-in account. */
export async function preparePrismInstance(options: {
  root?: string;
  stagedMods: string;
  bootstrap: string;
  instanceName?: string;
}): Promise<boolean> {
  if (/\s/u.test(options.bootstrap)) {
    throw new Error("Prism bootstrap path must not contain whitespace");
  }
  const root =
    options.root ??
    path.join(os.homedir(), "Library/Application Support/PrismLauncher");
  const name = z
    .string()
    .regex(/^[\w-]+$/u)
    .parse(options.instanceName ?? INSTANCE);
  const instance = path.join(root, "instances", name);
  const marker = path.join(instance, MARKER);
  const created = !(await exists(instance));
  if (created) {
    await mkdir(path.dirname(instance), { recursive: true, mode: 0o700 });
    await mkdir(instance, { mode: 0o700 });
    await writeFile(marker, "storm-control-v1\n", { flag: "wx", mode: 0o600 });
  } else {
    if (
      !(await exists(marker)) ||
      (await readFile(marker, "utf8")) !== "storm-control-v1\n"
    ) {
      throw new Error(
        `Refusing to overwrite an unmanaged Prism instance: ${instance}`,
      );
    }
  }
  const mods = path.join(instance, "minecraft", "mods");
  await mkdir(mods, { recursive: true, mode: 0o700 });
  const optionsFile = path.join(instance, "minecraft", "options.txt");
  if (!(await exists(optionsFile))) {
    await writeFile(optionsFile, AUTOMATED_CLIENT_OPTIONS_TXT, { mode: 0o600 });
  }
  const metadata = z
    .strictObject({
      minecraft: z.string().regex(/^[\w.+-]+$/u),
      fabricLoader: z.string().regex(/^[\w.+-]+$/u),
      clientJar: z.string().regex(/^[\w.+-]+\.jar$/u),
    })
    .parse(
      JSON.parse(
        await readFile(path.join(options.stagedMods, "metadata.json"), "utf8"),
      ),
    );
  await copyFile(
    path.join(options.stagedMods, "fabric-api.jar"),
    path.join(mods, "fabric-api.jar"),
  );
  await copyFile(
    path.join(options.stagedMods, metadata.clientJar),
    path.join(mods, "storm-client.jar"),
  );
  await writeFile(
    path.join(instance, "instance.cfg"),
    `[General]\nInstanceType=OneSix\nname=The Storm (controlled)\niconKey=default\nOverrideJavaArgs=true\nJvmArgs=-Dstorm.client.session=${options.bootstrap}\n`,
  );
  await writeFile(
    path.join(instance, "mmc-pack.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        components: [
          {
            uid: "net.minecraft",
            version: metadata.minecraft,
            important: true,
          },
          { uid: "net.fabricmc.fabric-loader", version: metadata.fabricLoader },
        ],
      },
      null,
      2,
    ),
  );
  return created;
}

async function readLogTail(logPath: string, offset: number) {
  const file = await open(logPath, "r");
  try {
    const info = await file.stat();
    if (info.size < offset) offset = 0;
    const buffer = Buffer.alloc(info.size - offset);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return {
      text: buffer.toString("utf8", 0, bytesRead),
      offset: offset + bytesRead,
    };
  } finally {
    await file.close();
  }
}

/** Wait for a running Prism process to discover a newly created instance. */
export async function waitForPrismDiscovery(
  logPath: string,
  offset: number,
  instanceName: string = INSTANCE,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let pending = "";
  while (Date.now() < deadline) {
    try {
      const tail = await readLogTail(logPath, offset);
      offset = tail.offset;
      pending += tail.text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (
        lines.some(
          (line) =>
            line.includes('Loaded instance "') &&
            line.includes(`/instances/${instanceName}"`),
        )
      )
        return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Prism did not discover controlled instance ${instanceName}; restart Prism and try again`,
  );
}

const MEMORY_PROMPT_MESSAGE =
  "Prism Launcher is paused at its macOS memory-pressure confirmation dialog (EnsureAvailableMemory); confirm or dismiss the Prism Launcher prompt or free system memory and retry";
const MEMORY_ABORT_MESSAGE =
  "Prism Launcher aborted at its macOS memory-pressure check (EnsureAvailableMemory); confirm the Prism Launcher prompt or free system memory and retry";

function isMemoryCheckCompleteLine(line: string): boolean {
  return (
    (line.includes("EnsureAvailableMemory") && line.includes("succeeded")) ||
    line.includes("LaunchMinecraft") ||
    line.includes("Minecraft process ID") ||
    line.includes("Launching instance")
  );
}

function isMemoryCheckFailedLine(line: string): boolean {
  return (
    line.includes("EnsureAvailableMemory") &&
    (line.includes("failed") || line.includes("aborted"))
  );
}

async function isSocketFile(socketPath: string): Promise<boolean> {
  try {
    const info = await lstat(socketPath);
    return info.isSocket();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/**
 * Watches `PrismLauncher-0.log` from `offset` so a stalled macOS
 * `EnsureAvailableMemory` modal dialog fails fast with an actionable prompt
 * instead of waiting out the 300 s client launch timeout.
 */
export function createPrismMemoryMonitor(options: {
  logPath: string;
  offset: number;
  graceMs?: number;
  now?: () => number;
}): { poll: () => Promise<void> } {
  let offset = options.offset;
  let pending = "";
  let promptStartedAt: number | undefined;
  const graceMs = options.graceMs ?? 3000;
  const now = options.now ?? (() => performance.now());

  const inspectLine = (line: string): void => {
    if (isMemoryCheckFailedLine(line)) {
      throw new Error(MEMORY_ABORT_MESSAGE);
    }
    if (isMemoryCheckCompleteLine(line)) {
      promptStartedAt = undefined;
      return;
    }
    if (line.includes("EnsureAvailableMemory")) {
      promptStartedAt ??= now();
    }
  };

  return {
    poll: async (): Promise<void> => {
      try {
        const tail = await readLogTail(options.logPath, offset);
        offset = tail.offset;
        pending += tail.text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          inspectLine(line);
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          throw error;
        }
      }
      if (promptStartedAt !== undefined && now() - promptStartedAt >= graceMs) {
        throw new Error(MEMORY_PROMPT_MESSAGE);
      }
    },
  };
}

export async function watchPrismMemoryPrompt(options: {
  logPath: string;
  offset: number;
  socketPath: string;
  signal: AbortSignal;
  graceMs?: number;
  pollMs?: number;
}): Promise<never> {
  const monitor = createPrismMemoryMonitor(
    options.graceMs === undefined
      ? { logPath: options.logPath, offset: options.offset }
      : {
          logPath: options.logPath,
          offset: options.offset,
          graceMs: options.graceMs,
        },
  );
  const pollMs = options.pollMs ?? 100;
  while (!options.signal.aborted) {
    if (await isSocketFile(options.socketPath)) {
      break;
    }
    await monitor.poll();
    await Bun.sleep(pollMs);
  }
  return Promise.withResolvers<never>().promise;
}

async function launcherFailure(child: Bun.Subprocess): Promise<never> {
  if ((await child.exited) !== 0)
    throw new Error("Prism Launcher could not start the controlled instance");
  return Promise.withResolvers<never>().promise;
}

export async function stageAndLaunchPrism(options: {
  repoRoot: string;
  name: string;
  privateDir: string;
  artifacts: string;
  bootstrap: string;
  prismRoot?: string;
}): Promise<{
  failure: Promise<never>;
  pid: number;
  instanceName: string;
  cleanup: () => Promise<void>;
}> {
  // Neither the bridge token nor the 1Password service account reaches Gradle or Prism.
  const env = {
    ...Bun.env,
    MC_BRIDGE_TOKEN: undefined,
    OP_SERVICE_ACCOUNT_TOKEN: undefined,
  };
  const stagedMods = path.join(options.privateDir, "prism-mods");
  const gradleCacheDir = path.join(options.privateDir, "gradle-cache");
  const log = Bun.file(path.join(options.artifacts, "build.log"));
  const stage = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(options.repoRoot, CLIENT_PROJECT),
      "--project-cache-dir",
      gradleCacheDir,
      "stagePrism",
      `-PprismModsDir=${stagedMods}`,
      "--console=plain",
      "--no-daemon",
    ],
    { cwd: options.repoRoot, env, stdout: log, stderr: log },
  );
  if ((await stage.exited) !== 0)
    throw new Error(
      `Prism mod build failed; see ${options.artifacts}/build.log`,
    );
  const prismRoot =
    options.prismRoot ??
    path.join(os.homedir(), "Library/Application Support/PrismLauncher");
  const instanceName = prismControlInstanceName(options.name);
  const instanceDir = path.join(prismRoot, "instances", instanceName);
  const prismLog = path.join(prismRoot, "logs/PrismLauncher-0.log");
  const running =
    Bun.spawnSync(["pgrep", "-x", "prismlauncher"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  const logInfo =
    running && (await exists(prismLog)) ? await stat(prismLog) : undefined;
  const offset = logInfo?.size ?? 0;
  const awake = Bun.spawn(
    ["/usr/bin/caffeinate", "-du", "-w", String(process.pid)],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  const watchAbort = new AbortController();
  let cleanedUp = false;
  const cleanup = async (retainDiagnostics = false): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    watchAbort.abort();
    try {
      awake.kill();
    } catch {
      // Caffeinate already exited.
    }
    if (retainDiagnostics) {
      try {
        await copyPrismDiagnostics(
          instanceDir,
          path.join(options.artifacts, "prism-diagnostics"),
        );
      } catch {
        // Best-effort diagnostic archive before removing instance.
      }
    }
    await rm(instanceDir, { recursive: true, force: true });
  };
  try {
    const socketPath = z
      .object({ socket: z.string() })
      .parse(JSON.parse(await readFile(options.bootstrap, "utf8"))).socket;
    const created = await preparePrismInstance({
      root: prismRoot,
      stagedMods,
      bootstrap: options.bootstrap,
      instanceName,
    });
    if (running && created) {
      await waitForPrismDiscovery(prismLog, offset, instanceName);
    }
    const launcher = Bun.which("prismlauncher");
    if (launcher === null) throw new Error("Prism Launcher is not installed");
    const launchLogInfo = (await exists(prismLog))
      ? await stat(prismLog)
      : undefined;
    const launchOffset = launchLogInfo?.size ?? 0;
    const child = Bun.spawn(
      prismControlLaunchArgs(launcher, instanceName, options.name),
      {
        env,
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    return {
      failure: Promise.race([
        launcherFailure(child),
        watchPrismMemoryPrompt({
          logPath: prismLog,
          offset: launchOffset,
          socketPath,
          signal: watchAbort.signal,
        }),
      ]),
      pid: child.pid,
      instanceName,
      cleanup: () => cleanup(true),
    };
  } catch (error) {
    await cleanup(true);
    throw error;
  }
}
