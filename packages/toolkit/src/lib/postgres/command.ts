/**
 * Running a command to completion and keeping its failure legible.
 *
 * Shared by the pod helpers and by callers that also drive local `psql`,
 * `createdb`, and `pg_restore`, so a dump-and-restore pipeline reports every
 * step the same way.
 */

/** Error naming the step, its exit code, and whatever it said before dying. */
export function commandFailure(
  label: string,
  exitCode: number,
  detail: string,
): Error {
  const trimmed = detail.trim();
  return new Error(
    `${label} exited ${String(exitCode)}: ${trimmed.length > 0 ? trimmed : "(no output)"}`,
  );
}

/**
 * Run a command and return its stdout.
 *
 * `label` keeps the error readable when the argv carries a connection URL or a
 * multi-line SQL statement.
 */
export async function captureCommand(input: {
  readonly args: readonly string[];
  readonly label?: string | undefined;
}): Promise<string> {
  const child = Bun.spawn([...input.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw commandFailure(
      input.label ?? input.args[0] ?? "command",
      exitCode,
      stderr.length > 0 ? stderr : stdout,
    );
  }
  return stdout;
}
