export type CommandResult = { stdout: string; stderr: string };

/** Runs a docker CLI command and fails loudly with its stderr on non-zero exit. */
export async function docker(args: readonly string[]): Promise<CommandResult> {
  const subprocess = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `docker ${args[0] ?? ""} failed (${exitCode.toString()}): ${stderr.trim()}`,
    );
  }
  return { stdout, stderr };
}
