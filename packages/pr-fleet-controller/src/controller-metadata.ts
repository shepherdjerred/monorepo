import path from "node:path";
import { z } from "zod";

const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

export async function resolveControllerCommit(
  controllerDirectory = path.join(import.meta.dir, ".."),
): Promise<string> {
  const subprocess = Bun.spawn(
    ["git", "-C", controllerDirectory, "rev-parse", "HEAD"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to resolve controller commit: ${stderr.trim()}`);
  }
  return GitCommitSchema.parse(stdout.trim());
}
