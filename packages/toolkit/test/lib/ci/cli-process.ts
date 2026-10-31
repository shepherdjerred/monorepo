import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));

/** Run `toolkit ci ...` in a child process and collect its result. */
export async function runCi(
  args: readonly string[],
): Promise<{ output: string; error: string; code: number }> {
  const child = Bun.spawn([process.execPath, "run", entry, "ci", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { output, error, code };
}
