/** Shell-free local acceptance commands. Never inherit the vault service account. */
export async function command(args: string[]): Promise<string> {
  const { OP_SERVICE_ACCOUNT_TOKEN: _vault, ...environment } = Bun.env;
  const child = Bun.spawn(args, {
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${args[0] ?? "Command"} failed (${String(code)}): ${stderr}`,
    );
  return stdout.trim();
}

/** Foreground readiness polling; a failed predicate never becomes approval. */
export async function until<T>(
  description: string,
  read: () => Promise<T | null>,
  milliseconds = 30_000,
): Promise<T> {
  const end = performance.now() + milliseconds;
  do {
    const result = await read();
    if (result !== null) return result;
    await Bun.sleep(100);
  } while (performance.now() < end);
  throw new Error(`Timed out waiting for ${description}`);
}
