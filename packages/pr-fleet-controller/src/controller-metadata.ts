import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CommandRequest, CommandResult } from "./ports.ts";
import { runCommand } from "./process-runner.ts";

const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

export type ControllerSource = {
  commit: string;
  dirty: boolean;
  fingerprint: string;
};

type GitResult = {
  stdout: string;
  stderr: string;
};

type ControllerSourceOptions = {
  controllerDirectory?: string;
  stateRoot?: string;
  run?: (request: CommandRequest) => Promise<CommandResult>;
};

async function runGit(
  controllerDirectory: string,
  args: readonly string[],
  run: (request: CommandRequest) => Promise<CommandResult>,
): Promise<GitResult> {
  const result = await run({
    executable: "git",
    args: ["-C", controllerDirectory, ...args],
    cwd: controllerDirectory,
    timeoutMs: 120_000,
    sensitiveOutput: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to resolve controller source: ${result.stderr.trim()}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

async function findGitRepositoryRoot(
  controllerDirectory: string,
): Promise<string | null> {
  let current = await realpath(controllerDirectory);
  while (path.dirname(current) !== current) {
    if (await pathExists(path.join(current, ".git"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return (await pathExists(path.join(current, ".git"))) ? current : null;
}

async function canonicalizePotentialPath(candidate: string): Promise<string> {
  const missing: string[] = [];
  let current = path.resolve(candidate);
  while (!(await pathExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Unable to resolve state directory ancestry: ${candidate}`,
      );
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(await realpath(current), ...missing);
}

/**
 * Reject an explicit state root inside the executing controller repository
 * before RunRecorder creates any files there. The later Git-based provenance
 * check remains the authoritative backstop after capture begins.
 */
export async function assertStateRootOutsideControllerRepository(
  stateRoot: string,
  controllerDirectory = path.join(import.meta.dir, ".."),
): Promise<void> {
  const repositoryRoot = await findGitRepositoryRoot(controllerDirectory);
  if (repositoryRoot === null) {
    return;
  }
  const [canonicalRepositoryRoot, canonicalStateRoot] = await Promise.all([
    realpath(repositoryRoot),
    canonicalizePotentialPath(stateRoot),
  ]);
  if (pathIsInside(canonicalRepositoryRoot, canonicalStateRoot)) {
    throw new Error(
      `Run-bundle state directory must be outside the controller repository: ${stateRoot}`,
    );
  }
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
  options: ControllerSourceOptions = {},
): Promise<ControllerSource> {
  const controllerDirectory =
    options.controllerDirectory ?? path.join(import.meta.dir, "..");
  const run = options.run ?? runCommand;
  const [commitResult, rootResult] = await Promise.all([
    runGit(controllerDirectory, ["rev-parse", "HEAD"], run),
    runGit(controllerDirectory, ["rev-parse", "--show-toplevel"], run),
  ]);
  const commit = GitCommitSchema.parse(commitResult.stdout.trim());
  const repositoryRoot = rootResult.stdout.trim();
  if (
    options.stateRoot !== undefined &&
    pathIsInside(
      await realpath(repositoryRoot),
      await realpath(options.stateRoot),
    )
  ) {
    throw new Error(
      `Run-bundle state directory must be outside the controller repository: ${options.stateRoot}`,
    );
  }
  // The controller can execute workspace packages and root scripts outside its
  // own package directory. Fingerprint the complete repository source state so
  // untracked or tracked workspace inputs cannot masquerade as the same run.
  const [statusResult, diffResult, untrackedResult] = await Promise.all([
    runGit(
      repositoryRoot,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      run,
    ),
    runGit(repositoryRoot, ["diff", "--binary", "--no-ext-diff", "HEAD"], run),
    runGit(
      repositoryRoot,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      run,
    ),
  ]);
  const dirty = statusResult.stdout.length > 0;
  const hash = createHash("sha256");
  hash.update(`controller-source-v1\0${commit}\0`);
  hash.update(statusResult.stdout);
  hash.update("\0tracked-diff\0");
  hash.update(diffResult.stdout);

  const untrackedPaths = untrackedResult.stdout
    .split("\0")
    .filter((entry) => entry.length > 0)
    .toSorted();
  for (const relativePath of untrackedPaths) {
    await hashUntrackedFile(hash, repositoryRoot, relativePath);
  }
  return { commit, dirty, fingerprint: hash.digest("hex") };
}
