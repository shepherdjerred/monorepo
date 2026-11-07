export type CapturedResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Run `argv` with no stdin, capturing both streams and the exit code. */
export async function spawnCapture(
  argv: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<CapturedResult> {
  const child = Bun.spawn([...argv], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: { ...options.env } }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}
