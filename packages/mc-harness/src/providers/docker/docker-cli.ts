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

async function killTimedOutDockerChild(
  subprocess: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  try {
    subprocess.kill("SIGTERM");
  } catch {
    return;
  }
  const exitedOnTerm = await Promise.race([
    subprocess.exited.then(() => true),
    Bun.sleep(250).then(() => false),
  ]);
  if (exitedOnTerm) {
    return;
  }
  try {
    subprocess.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([subprocess.exited, Bun.sleep(500)]);
}

/** Runs a docker CLI command with a bounded deadline and fails loudly on timeout or non-zero exit. */
export async function docker(
  args: readonly string[],
  options?: DockerCommandOptions,
): Promise<CommandResult> {
  const timeoutMs = options?.timeoutMs ?? defaultDockerTimeoutMs(args);
  const subcommand = args[0] ?? "";
  const executable =
    Bun.which("docker", { PATH: Bun.env["PATH"] ?? "" }) ?? "docker";
  const subprocess = Bun.spawn([executable, ...args], {
    env: Bun.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]).then(([stdout, stderr, exitCode]) => ({
      kind: "exited" as const,
      stdout,
      stderr,
      exitCode,
    })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timeout" });
      }, timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  if (outcome.kind === "timeout") {
    await Promise.allSettled([
      subprocess.stdout.cancel(),
      subprocess.stderr.cancel(),
      killTimedOutDockerChild(subprocess),
    ]);
    throw new Error(
      `docker ${subcommand} timed out after ${timeoutMs.toString()}ms`,
    );
  }

  if (outcome.exitCode !== 0) {
    throw new Error(
      `docker ${subcommand} failed (${outcome.exitCode.toString()}): ${outcome.stderr.trim()}`,
    );
  }
  return { stdout: outcome.stdout, stderr: outcome.stderr };
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
