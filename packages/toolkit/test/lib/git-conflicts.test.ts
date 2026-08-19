import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkMergeConflicts } from "#lib/git/conflicts.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

describe("independent merge-tree", () => {
  test("checks the fetched PR head against current origin/main", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "toolkit-merge-tree-"));
    temporaryDirectories.push(root);
    const origin = path.join(root, "origin.git");
    const seed = path.join(root, "seed");
    const checkout = path.join(root, "checkout");
    await mkdir(seed);
    await git(root, ["init", "--bare", origin]);
    await git(seed, ["init"]);
    await git(seed, ["config", "user.email", "test@example.com"]);
    await git(seed, ["config", "user.name", "Toolkit Test"]);
    await Bun.write(path.join(seed, "shared.txt"), "base\n");
    await git(seed, ["add", "shared.txt"]);
    await git(seed, ["commit", "-m", "base"]);
    await git(seed, ["branch", "-M", "main"]);
    await git(seed, ["remote", "add", "origin", origin]);
    await git(seed, ["push", "-u", "origin", "main"]);

    await git(seed, ["checkout", "-b", "feature"]);
    await Bun.write(path.join(seed, "shared.txt"), "feature\n");
    await git(seed, ["commit", "-am", "feature"]);
    const headSha = await git(seed, ["rev-parse", "HEAD"]);
    await git(seed, ["push", "origin", "HEAD:refs/pull/7/head"]);

    await git(seed, ["checkout", "main"]);
    await Bun.write(path.join(seed, "shared.txt"), "main changed\n");
    await git(seed, ["commit", "-am", "main changed"]);
    await git(seed, ["push", "origin", "main"]);

    await git(root, ["clone", origin, checkout]);
    const result = await checkMergeConflicts(7, "main", headSha, checkout);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictingFiles).toContain("shared.txt");
    expect(result.upToDate).toBe(false);
    expect(result.headSha).toBe(headSha);

    const staleHeadSha = await git(seed, ["rev-parse", "main"]);
    await expect(
      checkMergeConflicts(7, "main", staleHeadSha, checkout),
    ).rejects.toThrow("does not match GitHub head");
  });
});
