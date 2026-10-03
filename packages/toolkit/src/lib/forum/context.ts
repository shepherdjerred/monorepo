import path from "node:path";
import { z } from "zod";

const Detail = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/);
export const ForumContextSchema = z.object({
  model: Detail.max(120).nullable(),
  branch: Detail.nullable(),
  worktree: Detail.nullable(),
  repository: Detail.nullable(),
  cwd: Detail.nullable(),
});
export type ForumContext = z.infer<typeof ForumContextSchema>;
export const EMPTY_FORUM_CONTEXT: ForumContext = {
  model: null,
  branch: null,
  worktree: null,
  repository: null,
  cwd: null,
};

export async function captureForumContext(
  model?: string,
  cwd = process.cwd(),
): Promise<ForumContext> {
  const { output, stderr, code } = await inspectGit(cwd, [
    "rev-parse",
    "--show-toplevel",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (code !== 0) {
    if (code === 128 && stderr.includes("not a git repository"))
      return ForumContextSchema.parse({
        ...EMPTY_FORUM_CONTEXT,
        model: model ?? null,
        cwd,
      });
    throw new Error("Could not inspect Git context for forum profile");
  }
  const lines = output.trimEnd().split("\n");
  const [worktree, common] = lines;
  if (worktree === undefined || common === undefined || lines.length !== 2)
    throw new Error("Unexpected Git context for forum profile");
  return ForumContextSchema.parse({
    model: model ?? null,
    cwd,
    worktree,
    branch: await currentBranch(cwd),
    repository: path.dirname(common),
  });
}

async function inspectGit(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { output, stderr, code };
}

async function currentBranch(cwd: string): Promise<string> {
  const result = await inspectGit(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (result.code === 0) return result.output.trimEnd();
  if (result.code !== 1)
    throw new Error("Could not inspect forum profile branch");
  const commit = await inspectGit(cwd, ["rev-parse", "--short", "HEAD"]);
  if (commit.code !== 0)
    throw new Error("Could not inspect detached forum profile revision");
  return `Detached at ${commit.output.trimEnd()}`;
}
