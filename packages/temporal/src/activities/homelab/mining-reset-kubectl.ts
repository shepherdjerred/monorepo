import { z } from "zod";

/** The minecraft-tsmc StatefulSet's desired and ready replica counts. */
export const StatefulSetReplicas = z.object({
  spec: z.object({ replicas: z.number().int().nonnegative() }),
  status: z
    .object({ readyReplicas: z.number().int().nonnegative().optional() })
    .optional(),
});

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type Command = (
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>;

export async function kubectl(
  args: readonly string[],
  input?: string,
): Promise<CommandResult> {
  const process = Bun.spawn(["kubectl", ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    if (process.stdin === undefined) {
      throw new Error("kubectl stdin pipe was not created");
    }
    await process.stdin.write(input);
    await process.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export function commandFailure(
  args: readonly string[],
  result: CommandResult,
): Error {
  // Keep API errors but never log command input, which can include manifest
  // or deployment environment values.
  return new Error(
    `kubectl ${args.join(" ")} failed (${String(result.exitCode)}): ${result.stderr.trim()}`,
  );
}

export async function run(
  command: Command,
  args: readonly string[],
  input?: string,
): Promise<string> {
  const result = await command(args, input);
  if (result.exitCode !== 0) {
    throw commandFailure(args, result);
  }
  return result.stdout;
}
