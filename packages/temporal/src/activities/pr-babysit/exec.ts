/**
 * Minimal subprocess helpers for the babysitter's git/gh calls.
 *
 * `capture` never throws on a non-zero exit — `gh pr checks` deliberately exits
 * non-zero when checks are pending/failing (which is a legitimate answer, not
 * an error), and `git merge-tree` exits 1 on a conflict. Callers inspect
 * `exitCode` themselves. `run` is the throwing variant for commands where a
 * non-zero exit really is a failure (e.g. `git fetch`).
 */

export type CaptureResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ExecOptions = {
  cwd?: string;
  /** Extra env merged over the current process env (PATH etc. preserved). */
  env?: Record<string, string>;
};

export async function capture(
  command: readonly string[],
  options: ExecOptions = {},
): Promise<CaptureResult> {
  const proc = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined
      ? {}
      : { env: { ...Bun.env, ...options.env } }),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export async function run(
  command: readonly string[],
  options: ExecOptions = {},
): Promise<string> {
  const result = await capture(command, options);
  if (result.exitCode !== 0) {
    const detail =
      result.stderr.trim().length > 0 ? result.stderr : result.stdout;
    throw new Error(
      `${command[0] ?? "command"} failed (exit ${String(result.exitCode)}): ${detail.trim()}`,
    );
  }
  return result.stdout.trim();
}
