export type SubprocessResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/** Run a piped subprocess while draining both output streams concurrently. */
export async function runSubprocess(
  command: string[],
  signal: AbortSignal,
): Promise<SubprocessResult> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    signal,
  });
  const output = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    stdout: output[0],
    stderr: output[1],
    exitCode: output[2],
  };
}
