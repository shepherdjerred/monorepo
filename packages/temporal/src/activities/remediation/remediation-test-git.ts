import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";

export async function createRemediationTestGitRepo(options: {
  prefix: string;
  files: Readonly<Record<string, string>>;
  repoSubdir?: string;
}): Promise<{
  tempDir: string;
  repoDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(nodePath.join(tmpdir(), options.prefix));
  const repoDir = `${tempDir}/${options.repoSubdir ?? "repo"}`;
  await mkdir(repoDir, { recursive: true });
  await runCommand(["git", "init", "-b", "main"], { cwd: repoDir });
  await runCommand(["git", "config", "user.email", "test@sjer.red"], {
    cwd: repoDir,
  });
  await runCommand(["git", "config", "user.name", "Test Bot"], {
    cwd: repoDir,
  });

  for (const [relativePath, content] of Object.entries(options.files)) {
    const fullPath = `${repoDir}/${relativePath}`;
    await mkdir(nodePath.dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, content);
  }

  await runCommand(["git", "add", "."], { cwd: repoDir });
  await runCommand(["git", "commit", "-m", "init"], { cwd: repoDir });

  return {
    tempDir,
    repoDir,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}
