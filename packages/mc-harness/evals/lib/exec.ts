import type { CommandResult } from "#evals/lib/types.ts";

export type ExecOptions = {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Stream stdout to this file instead of buffering it. */
  stdoutFile?: string;
  stderrFile?: string;
};

export type ExecResult = CommandResult & { timedOut: boolean };

/** Runs a command to completion; kills it (SIGKILL) past `timeoutMs`. */
export async function exec(
  argv: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const proc = Bun.spawn([...argv], {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    stdin: "ignore",
    stdout:
      options.stdoutFile === undefined ? "pipe" : Bun.file(options.stdoutFile),
    stderr:
      options.stderrFile === undefined ? "pipe" : Bun.file(options.stderrFile),
  });
  let timedOut = false;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout instanceof ReadableStream
      ? new Response(proc.stdout).text()
      : Promise.resolve(""),
    proc.stderr instanceof ReadableStream
      ? new Response(proc.stderr).text()
      : Promise.resolve(""),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}

/** Like exec, but throws with stderr on a non-zero exit. */
export async function execOk(
  argv: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const result = await exec(argv, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${argv.join(" ")} failed (${String(result.exitCode)}): ${result.stderr.trim().slice(-800)}`,
    );
  }
  return result;
}
