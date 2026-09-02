export type RawCommandOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
};

export type CommandCapture = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function mergeCommandEnvironment(
  environment: Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && !(key in overrides)) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export async function captureCommand(
  command: string[],
  options: RawCommandOptions,
): Promise<CommandCapture> {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: mergeCommandEnvironment(Bun.env, options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}
