import type { z } from "zod";

/** Capture subprocesses without inheriting secret-bearing stdout. */
export async function capture(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const child = Bun.spawn([...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => {
    child.kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    signal?.throwIfAborted();
    if (code !== 0)
      throw new Error(
        `${args[0] ?? "Command"} failed (${String(code)}): ${stderr.trim()}`,
      );
    return stdout;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function captureJson<T>(
  args: readonly string[],
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  return schema.parse(JSON.parse(await capture(args, signal)));
}

export async function githubToken(): Promise<string> {
  const supplied = Bun.env["GH_TOKEN"];
  const credential = supplied ?? (await capture(["gh", "auth", "token"]));
  const token = credential.trim();
  if (token.trim() === "") throw new Error("GitHub credential is empty");
  return token;
}
