import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { CommandRequest, CommandResult } from "./ports.ts";

const GIT_TIMEOUT_MS = 120_000;
const GIT_OUTPUT_LIMIT_BYTES = 16_384;
const GIT_SPICE_DATA_REF = "refs/spice/data";

export type ManagedCheckoutPaths = {
  checkout: string;
  worktreeRoot: string;
};

export type PrepareManagedCheckoutOptions = {
  sourceCheckout: string;
  checkout: string;
  worktreeRoot: string;
  run: (request: CommandRequest) => Promise<CommandResult>;
};

function repositoryDirectoryName(repository: string): string {
  const normalized = repository.replaceAll("/", "--");
  const safe = normalized.replaceAll(/[^\w.-]/g, "_");
  if (safe.length === 0) {
    throw new Error("Repository name must contain at least one safe character");
  }
  return `repo-${safe}`;
}

export function resolveManagedCheckoutPaths(options: {
  repository: string;
  stateDirectory: string;
  checkout?: string | undefined;
  worktreeRoot?: string | undefined;
}): ManagedCheckoutPaths {
  const stateDirectory = path.resolve(options.stateDirectory);
  const directoryName = repositoryDirectoryName(options.repository);
  const checkout = path.resolve(
    options.checkout ?? path.join(stateDirectory, "checkouts", directoryName),
  );
  const worktreeRoot = path.resolve(
    options.worktreeRoot ??
      path.join(stateDirectory, "worktrees", directoryName),
  );
  if (checkout === worktreeRoot) {
    throw new Error(
      "Managed checkout and worktree root must be different paths",
    );
  }
  return { checkout, worktreeRoot };
}

function commandFailure(action: string, result: CommandResult): Error {
  const detail = result.stderr.trim();
  return new Error(
    detail.length === 0 ? `${action} failed` : `${action} failed: ${detail}`,
  );
}

function normalizeRemoteUrl(url: string): string {
  return url
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function runGit(
  run: PrepareManagedCheckoutOptions["run"],
  cwd: string,
  args: string[],
  sensitiveOutput = true,
): Promise<CommandResult> {
  return run({
    executable: "git",
    args,
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: GIT_OUTPUT_LIMIT_BYTES,
    sensitiveOutput,
  });
}

async function mustRunGit(
  run: PrepareManagedCheckoutOptions["run"],
  cwd: string,
  args: string[],
  action: string,
): Promise<CommandResult> {
  const result = await runGit(run, cwd, args);
  if (result.exitCode !== 0) {
    throw commandFailure(action, result);
  }
  return result;
}

async function directoryExists(candidate: string): Promise<boolean> {
  try {
    const stats = await lstat(candidate);
    return stats.isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function refersToSameDirectory(
  first: string,
  second: string,
): Promise<boolean> {
  if (path.resolve(first) === path.resolve(second)) {
    return true;
  }
  try {
    return (await realpath(first)) === (await realpath(second));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Creates or refreshes the controller's own clone. The checkout from which the
 * CLI was launched is used only to discover the remote and local git-spice
 * metadata; it is never handed to a worker.
 */
export async function prepareManagedCheckout(
  options: PrepareManagedCheckoutOptions,
): Promise<ManagedCheckoutPaths> {
  const sourceCheckout = path.resolve(options.sourceCheckout);
  const checkout = path.resolve(options.checkout);
  const worktreeRoot = path.resolve(options.worktreeRoot);
  if (checkout === worktreeRoot) {
    throw new Error(
      "Managed checkout and worktree root must be different paths",
    );
  }
  if (await refersToSameDirectory(sourceCheckout, checkout)) {
    throw new Error(
      "Managed checkout must differ from the checkout that launched the controller",
    );
  }

  if (await directoryExists(checkout)) {
    const repository = await mustRunGit(
      options.run,
      checkout,
      ["rev-parse", "--is-inside-work-tree"],
      `Managed checkout ${checkout} is not a Git repository`,
    );
    if (repository.stdout.trim() !== "true") {
      throw new Error(`Managed checkout ${checkout} is not a Git repository`);
    }
    const status = await mustRunGit(
      options.run,
      checkout,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      `Could not inspect managed checkout ${checkout}`,
    );
    if (status.stdout.length > 0) {
      throw new Error(
        `Managed checkout ${checkout} has local changes; refusing to reset or reuse it`,
      );
    }
    const sourceRemote = await mustRunGit(
      options.run,
      sourceCheckout,
      ["remote", "get-url", "origin"],
      `Could not read origin from source checkout ${sourceCheckout}`,
    );
    const managedRemote = await mustRunGit(
      options.run,
      checkout,
      ["remote", "get-url", "origin"],
      `Could not read origin from managed checkout ${checkout}`,
    );
    if (
      normalizeRemoteUrl(sourceRemote.stdout) !==
      normalizeRemoteUrl(managedRemote.stdout)
    ) {
      throw new Error(
        `Managed checkout ${checkout} points to a different repository than ${sourceCheckout}`,
      );
    }
  } else {
    await mkdir(path.dirname(checkout), { recursive: true, mode: 0o700 });
    const remote = await mustRunGit(
      options.run,
      sourceCheckout,
      ["remote", "get-url", "origin"],
      `Could not read origin from source checkout ${sourceCheckout}`,
    );
    const remoteUrl = remote.stdout.trim();
    if (remoteUrl.length === 0) {
      throw new Error(
        `Source checkout ${sourceCheckout} has an empty origin URL`,
      );
    }
    await mustRunGit(
      options.run,
      path.dirname(checkout),
      ["clone", "--origin", "origin", remoteUrl, checkout],
      `Could not create managed checkout ${checkout}`,
    );
  }

  const spiceRef = await runGit(options.run, sourceCheckout, [
    "show-ref",
    "--verify",
    "--quiet",
    GIT_SPICE_DATA_REF,
  ]);
  if (spiceRef.exitCode === 0) {
    await mustRunGit(
      options.run,
      checkout,
      ["fetch", sourceCheckout, `+${GIT_SPICE_DATA_REF}:${GIT_SPICE_DATA_REF}`],
      `Could not copy git-spice metadata into managed checkout ${checkout}`,
    );
  } else if (spiceRef.exitCode === 1) {
    await mustRunGit(
      options.run,
      checkout,
      ["update-ref", "-d", GIT_SPICE_DATA_REF],
      `Could not clear stale git-spice metadata from managed checkout ${checkout}`,
    );
  } else {
    throw commandFailure(
      `Could not inspect git-spice metadata in source checkout ${sourceCheckout}`,
      spiceRef,
    );
  }

  await mustRunGit(
    options.run,
    checkout,
    ["fetch", "--prune", "origin"],
    `Could not refresh managed checkout ${checkout}`,
  );
  return { checkout, worktreeRoot };
}
