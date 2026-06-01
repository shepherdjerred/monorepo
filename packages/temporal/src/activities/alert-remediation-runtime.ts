export type AlertRemediationRunCommandInput = {
  command: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  redactOutput?: boolean;
};

export type AlertRemediationDeps = {
  runCommand: (input: AlertRemediationRunCommandInput) => Promise<string>;
  now: () => Date;
};

export async function defaultRunCommand(
  input: AlertRemediationRunCommandInput,
): Promise<string> {
  const childEnv: Record<string, string> = {};
  const clearedEnvKeys = new Set(
    Object.entries(input.env ?? {})
      .filter(([, value]) => value === undefined)
      .map(([key]) => key),
  );
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !clearedEnvKeys.has(key)) {
      childEnv[key] = value;
    }
  }
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  const proc = Bun.spawn(input.command, {
    cwd: input.cwd,
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
      input.redactOutput === true ? "<redacted>" : `${stdout}\n${stderr}`;
    throw new Error(
      `Command failed (${input.command.join(" ")}): exit ${String(exitCode)} ${output.trim()}`,
    );
  }

  return stdout.trim();
}

export const defaultAlertRemediationDeps: AlertRemediationDeps = {
  runCommand: defaultRunCommand,
  now: () => new Date(),
};
