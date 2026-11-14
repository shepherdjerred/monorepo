import type { z } from "zod";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Runs one command to completion. Tests inject a fake. */
export type CommandRunner = (
  command: readonly string[],
  stdin?: string,
) => Promise<CommandResult>;

/** A missing binary is a result (exit 127), so callers can report it. */
export const runCommand: CommandRunner = async (command, stdin) => {
  try {
    const child = Bun.spawn([...command], {
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

export function commandFailure(
  command: readonly string[],
  result: CommandResult,
): string {
  const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
  return `${command.join(" ")} exited ${String(result.exitCode)}: ${detail}`;
}

/** `kubectl <args> -o json`, validated. A non-zero exit or another shape throws. */
export async function kubectlJson<SCHEMA extends z.ZodType>(
  run: CommandRunner,
  args: readonly string[],
  schema: SCHEMA,
): Promise<z.infer<SCHEMA>> {
  const command = ["kubectl", ...args, "-o", "json"];
  const result = await run(command);
  if (result.exitCode !== 0) {
    throw new Error(commandFailure(command, result));
  }
  return schema.parse(JSON.parse(result.stdout));
}
