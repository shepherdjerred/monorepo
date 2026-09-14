export type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

export type RunCommandOptions = Readonly<{
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  unsetEnv?: readonly string[];
  stdin?: string;
  timeoutMs?: number;
  graceMs?: number;
}>;

export type CommandRunner = (
  command: readonly string[],
  options?: RunCommandOptions,
) => Promise<CommandResult>;

function childEnvironment(options: RunCommandOptions): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !(options.unsetEnv ?? []).includes(key)) {
      environment[key] = value;
    }
  }
  return { ...environment, ...options.env };
}

export const runCommand: CommandRunner = async (command, options = {}) => {
  if (command.length === 0) throw new Error("Command must not be empty");
  const child = Bun.spawn([...command], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: childEnvironment(options),
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && child.stdin !== undefined) {
    await child.stdin.write(options.stdin);
    await child.stdin.end();
  }

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.graceMs ?? 15_000);
  }, timeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timeout);
  if (killTimer !== undefined) clearTimeout(killTimer);
  return { exitCode, stdout, stderr, timedOut };
};

export function requireSuccess(
  label: string,
  result: CommandResult,
): CommandResult {
  if (result.exitCode !== 0) {
    const suffix = result.timedOut
      ? " timed out"
      : ` failed with exit code ${String(result.exitCode)}`;
    throw new Error(`${label}${suffix}: ${result.stderr.trim()}`);
  }
  return result;
}
