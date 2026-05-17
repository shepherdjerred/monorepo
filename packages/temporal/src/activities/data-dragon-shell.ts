export async function runCommand(
  command: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    redactOutput?: boolean;
  },
): Promise<string> {
  const clearedEnvKeys = new Set(
    Object.entries(options.env ?? {})
      .filter(([, value]) => value === undefined)
      .map(([key]) => key),
  );
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !clearedEnvKeys.has(key)) {
      childEnv[key] = value;
    }
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output =
      options.redactOutput === true
        ? "<redacted>"
        : `${stdout}\n${stderr}`.trim();
    throw new Error(
      `Command failed (${command.join(" ")}): exit ${String(exitCode)} ${output}`,
    );
  }

  return stdout.trim();
}
