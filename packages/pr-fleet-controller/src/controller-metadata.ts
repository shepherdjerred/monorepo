import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

export type ControllerSource = {
  commit: string;
  dirty: boolean;
  fingerprint: string;
};

type GitResult = {
  stdout: Uint8Array;
  stderr: string;
};

async function runGit(
  controllerDirectory: string,
  args: readonly string[],
): Promise<GitResult> {
  const subprocess = Bun.spawn(["git", "-C", controllerDirectory, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).arrayBuffer(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to resolve controller source: ${stderr.trim()}`);
  }
  return { stdout: new Uint8Array(stdout), stderr };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function hashUntrackedFile(
  hash: ReturnType<typeof createHash>,
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const stats = await lstat(absolutePath);
  hash.update(`untracked\0${relativePath}\0`);
  if (stats.isSymbolicLink()) {
    hash.update(`symlink\0${await readlink(absolutePath)}\0`);
    return;
  }
  if (!stats.isFile()) {
    throw new Error(
      `Unsupported untracked controller source entry: ${relativePath}`,
    );
  }
  hash.update("file\0");
  hash.update(await readFile(absolutePath));
  hash.update("\0");
}

/**
 * Resolve both the committed revision and an identity for the exact source tree
 * executing the controller. The fingerprint covers HEAD, tracked changes, and
 * every non-ignored untracked file, so dirty development runs cannot masquerade
 * as runs from their clean HEAD commit.
 */
export async function resolveControllerSource(
  controllerDirectory = path.join(import.meta.dir, ".."),
): Promise<ControllerSource> {
  const [commitResult, rootResult, statusResult, diffResult, untrackedResult] =
    await Promise.all([
      runGit(controllerDirectory, ["rev-parse", "HEAD"]),
      runGit(controllerDirectory, ["rev-parse", "--show-toplevel"]),
      runGit(controllerDirectory, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      runGit(controllerDirectory, [
        "diff",
        "--binary",
        "--no-ext-diff",
        "HEAD",
        "--",
      ]),
      runGit(controllerDirectory, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--full-name",
        "-z",
      ]),
    ]);
  const commit = GitCommitSchema.parse(decode(commitResult.stdout).trim());
  const repositoryRoot = decode(rootResult.stdout).trim();
  const dirty = statusResult.stdout.byteLength > 0;
  const hash = createHash("sha256");
  hash.update(`controller-source-v1\0${commit}\0`);
  hash.update(statusResult.stdout);
  hash.update("\0tracked-diff\0");
  hash.update(diffResult.stdout);

  const untrackedPaths = decode(untrackedResult.stdout)
    .split("\0")
    .filter((entry) => entry.length > 0)
    .toSorted();
  for (const relativePath of untrackedPaths) {
    await hashUntrackedFile(hash, repositoryRoot, relativePath);
  }
  return { commit, dirty, fingerprint: hash.digest("hex") };
}
