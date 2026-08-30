export async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    return stdout.trim();
  }
  throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}
