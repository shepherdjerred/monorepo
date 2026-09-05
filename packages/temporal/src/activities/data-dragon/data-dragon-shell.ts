import { captureCommand } from "#activities/command-runner.ts";

export async function runCommand(
  command: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    redactOutput?: boolean;
    trimStdout?: boolean;
  },
): Promise<string> {
  const { stdout, stderr, exitCode } = await captureCommand(command, options);

  if (exitCode !== 0) {
    const output =
      options.redactOutput === true
        ? "<redacted>"
        : `${stdout}\n${stderr}`.trim();
    throw new Error(
      `Command failed (${command.join(" ")}): exit ${String(exitCode)} ${output}`,
    );
  }

  return options.trimStdout === false ? stdout : stdout.trim();
}
