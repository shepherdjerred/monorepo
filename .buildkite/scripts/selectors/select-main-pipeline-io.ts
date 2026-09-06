export function processEnv(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export async function runCommand(
  command: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<number> {
  const child = Bun.spawn([...command], {
    env: { ...processEnv(), ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stdout.length > 0) await Bun.stdout.write(stdout);
  if (stderr.length > 0) await Bun.stderr.write(stderr);
  return exitCode;
}

/** Upload the selected graph with `--replace`, making selector retries safe. */
export function pipelineUploadArguments(
  changedFilesPath: string | undefined,
): string[] {
  const argumentsList = ["buildkite-agent", "pipeline", "upload", "--replace"];
  if (changedFilesPath !== undefined) {
    argumentsList.push("--changed-files-path", changedFilesPath);
  }
  return argumentsList;
}
