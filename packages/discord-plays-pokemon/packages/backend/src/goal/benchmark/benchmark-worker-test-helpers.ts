/** Pipes workerSource into a fresh `bun run -` in cwd and collects its output. */
export async function bootWorkerSource(
  cwd: string,
  workerSource: string,
): Promise<{ output: string; exitCode: number }> {
  const child = Bun.spawn(["bun", "run", "-"], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.stdin.write(workerSource);
  await child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { output: stdout + stderr, exitCode };
}
