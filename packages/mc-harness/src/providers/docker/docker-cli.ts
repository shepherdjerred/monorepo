import { BOOT_TIMEOUT_MS } from "#sandbox/boot.ts";

export type CommandResult = { stdout: string; stderr: string };

export type DockerCommandOptions = {
  timeoutMs?: number;
};

/** Fast local daemon probes (`info`, `ps`, `port`, `logs`, `rm`, `inspect`, `start`). */
export const DOCKER_CLI_TIMEOUT_MS = 15_000;

const SLOW_DOCKER_SUBCOMMANDS = new Set(["create", "run", "cp"]);

export function defaultDockerTimeoutMs(args: readonly string[]): number {
  const subcommand = args[0] ?? "";
  return SLOW_DOCKER_SUBCOMMANDS.has(subcommand)
    ? BOOT_TIMEOUT_MS
    : DOCKER_CLI_TIMEOUT_MS;
}

function tryKill(
  child: ReturnType<typeof Bun.spawn>,
  signal: "SIGTERM" | "SIGKILL",
): boolean {
  try {
    child.kill(signal);
    return true;
  } catch {
    return false;
  }
}

async function stopWedgedDockerProcess(
  child: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  if (!tryKill(child, "SIGTERM")) return;
  const terminated = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(250).then(() => false),
  ]);
  if (!terminated && tryKill(child, "SIGKILL")) {
    await Promise.race([child.exited, Bun.sleep(500)]);
  }
}

/** Runs a docker CLI command with a bounded deadline and fails loudly on timeout or non-zero exit. */
export async function docker(
  args: readonly string[],
  options?: DockerCommandOptions,
): Promise<CommandResult> {
  const timeoutMs = options?.timeoutMs ?? defaultDockerTimeoutMs(args);
  const subcommand = args[0] ?? "";
  const binary =
    Bun.which("docker", { PATH: Bun.env["PATH"] ?? "" }) ?? "docker";
  const child = Bun.spawn([binary, ...args], {
    env: Bun.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const state: { timedOut: boolean; reaper?: Promise<void> } = {
    timedOut: false,
  };
  const deadlineTimer = setTimeout(() => {
    state.timedOut = true;
    state.reaper = stopWedgedDockerProcess(child);
  }, timeoutMs);
  deadlineTimer.unref();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text().catch(() => ""),
    new Response(child.stderr).text().catch(() => ""),
    child.exited,
  ]).finally(() => {
    clearTimeout(deadlineTimer);
  });

  if (state.timedOut) {
    await state.reaper;
    throw new Error(
      `docker ${subcommand} timed out after ${timeoutMs.toString()}ms`,
    );
  }
  if (exitCode !== 0) {
    throw new Error(
      `docker ${subcommand} failed (${exitCode.toString()}): ${stderr.trim()}`,
    );
  }
  return { stdout, stderr };
}

type ServerLogSource =
  | { kind: "container"; containerId: string }
  | { kind: "external"; logFile: string };

export const serverLogs = async (info: ServerLogSource): Promise<string> =>
  info.kind === "external"
    ? Bun.file(info.logFile).text()
    : containerLogs(info.containerId);

async function containerLogs(containerId: string): Promise<string> {
  const { stdout } = await docker(["logs", containerId], {
    timeoutMs: DOCKER_CLI_TIMEOUT_MS,
  });
  return stdout;
}
