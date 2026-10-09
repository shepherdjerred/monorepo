import { z } from "zod";

export const CommitSchema = z.string().regex(/^[a-f\d]{40}$/u);
export const SnapshotSchema = z.object({
  version: z.literal(1),
  repository: z.string(),
  commit: CommitSchema,
  tree: CommitSchema,
  objectBytes: z.number().int().nonnegative(),
});

/** Git sees no ambient credentials, hooks, global config, or object alternates. */
export async function git(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: {
      PATH: Bun.env["PATH"],
      HOME: "/nonexistent",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
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
      `Source checkout git ${args[0] ?? ""} failed (${String(code)}): ${stderr.slice(-2000)}`,
    );
  return stdout.trim();
}

export async function verifyObjects(
  workspace: string,
  commit: string,
): Promise<string> {
  await git(workspace, ["fsck", "--strict", "--full", "--no-reflogs", commit]);
  const actual = await git(workspace, ["rev-parse", `${commit}^{commit}`]);
  if (actual !== commit)
    throw new Error("Checkout commit differs from requested source");
  return CommitSchema.parse(
    await git(workspace, ["rev-parse", `${commit}^{tree}`]),
  );
}
