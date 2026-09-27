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
  // These commands read only fixed Kubernetes resources. Keep API errors but
  // never log manifest input, which can include deployment environment values.
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

export async function readOptional(
  command: Command,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await command(args);
  if (result.exitCode === 0) {
    return result.stdout;
  }
  if (
    result.stderr.includes("NotFound") ||
    result.stderr.includes("not found")
  ) {
    return undefined;
  }
  throw commandFailure(args, result);
}
