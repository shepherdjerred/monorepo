import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resetVersionBumpBranch } from "./update-versions.ts";

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${exitCode.toString()}): ${stderr}`,
    );
  }
  return stdout.trim();
}

test("reconstructs a stale conflicting bump branch from current main", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "version-bump-branch-"));
  const versionsFile = path.join(repo, "versions.ts");

  try {
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "ci@sjer.red"]);
    await git(repo, ["config", "user.name", "CI Bot"]);
    await Bun.write(versionsFile, 'export const image = "base";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "base"]);

    await git(repo, ["checkout", "-b", "chore/version-bump-pending"]);
    await Bun.write(versionsFile, 'export const image = "stale-bump";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "stale bump"]);

    await git(repo, ["checkout", "main"]);
    await Bun.write(versionsFile, 'export const image = "current-main";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "advance main"]);
    await git(repo, [
      "update-ref",
      "refs/remotes/origin/main",
      await git(repo, ["rev-parse", "main"]),
    ]);
    await git(repo, ["checkout", "chore/version-bump-pending"]);

    await resetVersionBumpBranch((args) => git(repo, args));

    expect(await git(repo, ["branch", "--show-current"])).toBe(
      "chore/version-bump-pending",
    );
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(
      await git(repo, ["rev-parse", "origin/main"]),
    );
    expect(await Bun.file(versionsFile).text()).toBe(
      'export const image = "current-main";\n',
    );
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 20_000);
