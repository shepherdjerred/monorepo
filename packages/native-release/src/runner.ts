/**
 * The process seam every signing helper goes through. Production code uses
 * {@link bunRunner}; tests pass a recording runner so no test ever signs,
 * notarizes or touches a keychain.
 */

/** How a child's stdout and stderr are handled. */
export type OutputMode = "inherit" | "capture" | "ignore";

export type CommandOptions = {
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Text written to the child's stdin; the child gets no stdin when unset. */
  readonly stdin?: string | undefined;
  /** Defaults to `inherit`. */
  readonly output?: OutputMode | undefined;
};

export type CommandResult = {
  readonly exitCode: number;
  /** Empty unless `output` was `capture`. */
  readonly stdout: string;
  /** Empty unless `output` was `capture`. */
  readonly stderr: string;
};

/** Runs one command to completion and reports how it ended. Never throws on a non-zero exit. */
export type ProcessRunner = (
  command: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

/** The real runner, backed by `Bun.spawn`. */
export const bunRunner: ProcessRunner = async (command, options = {}) => {
  const output = options.output ?? "inherit";
  const child = Bun.spawn([...command], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env === undefined ? Bun.env : { ...options.env },
    stdin:
      options.stdin === undefined
        ? "ignore"
        : new TextEncoder().encode(options.stdin),
    stdout: output === "capture" ? "pipe" : output,
    stderr: output === "capture" ? "pipe" : output,
  });
  if (output !== "capture") {
    return { exitCode: await child.exited, stdout: "", stderr: "" };
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

export type RunOptions = Omit<CommandOptions, "output">;

/**
 * Run a command, streaming its output, or throw describing it. There is
 * deliberately no keep-going mode: a half-done signing step stops the lane.
 */
export async function run(
  runner: ProcessRunner,
  command: readonly string[],
  options: RunOptions = {},
): Promise<void> {
  const result = await runner(command, { ...options, output: "inherit" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited ${String(result.exitCode)}`);
  }
}

export type CaptureOptions = RunOptions & {
  /**
   * Append stderr to stdout. For tools that report on the wrong stream:
   * `codesign --display` writes its whole summary to stderr.
   */
  readonly includeStderr?: boolean | undefined;
};

/** Run a command and return its stdout (and stderr when asked); throw on a non-zero exit. */
export async function capture(
  runner: ProcessRunner,
  command: readonly string[],
  options: CaptureOptions = {},
): Promise<string> {
  const { includeStderr, ...rest } = options;
  const result = await runner(command, { ...rest, output: "capture" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${String(result.exitCode)}\n${result.stdout}${result.stderr}`,
    );
  }
  return includeStderr === true
    ? `${result.stdout}${result.stderr}`
    : result.stdout;
}

/** Whether a command exits 0, discarding its output; for probing tools and credentials. */
export async function succeeds(
  runner: ProcessRunner,
  command: readonly string[],
  options: RunOptions = {},
): Promise<boolean> {
  const result = await runner(command, { ...options, output: "ignore" });
  return result.exitCode === 0;
}
