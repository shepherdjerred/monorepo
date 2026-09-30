import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

export async function readOpReference(
  reference: string,
  run: CommandRunner,
): Promise<string> {
  const result = requireSuccess(
    "1Password reference lookup",
    await run(["op", "read", reference]),
  );
  const secret = result.stdout.trim();
  if (secret === "") throw new Error("1Password returned an empty value");
  return secret;
}
