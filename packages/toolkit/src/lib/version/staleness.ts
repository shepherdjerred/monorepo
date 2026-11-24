import path from "node:path";
import {
  computeInputTreeDigest,
  defaultGitSyncRunner,
  TOOLKIT_BUILD_INPUT_PATHS,
  type GitSyncRunner,
  type ToolkitBuildStamp,
} from "./build-stamp.ts";

declare const TOOLKIT_BUILD_COMMIT: string | undefined;
declare const TOOLKIT_BUILD_INPUT_DIGEST: string | undefined;
declare const TOOLKIT_BUILT_AT: string | undefined;

function readNonEmptyGlobal(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function embeddedToolkitBuildStamp(): ToolkitBuildStamp | null {
  const commit = readNonEmptyGlobal(
    typeof TOOLKIT_BUILD_COMMIT === "string" ? TOOLKIT_BUILD_COMMIT : undefined,
  );
  const inputDigest = readNonEmptyGlobal(
    typeof TOOLKIT_BUILD_INPUT_DIGEST === "string"
      ? TOOLKIT_BUILD_INPUT_DIGEST
      : undefined,
  );
  const builtAt = readNonEmptyGlobal(
    typeof TOOLKIT_BUILT_AT === "string" ? TOOLKIT_BUILT_AT : undefined,
  );
  return commit === null || inputDigest === null || builtAt === null
    ? null
    : { commit, inputDigest, builtAt };
}

export function formatToolkitVersion(
  baseVersion: string,
  stamp: ToolkitBuildStamp | null = embeddedToolkitBuildStamp(),
): string {
  const prefix = baseVersion.startsWith("toolkit ")
    ? baseVersion
    : `toolkit ${baseVersion}`;
  if (stamp === null) {
    return prefix;
  }
  const shortSha = stamp.commit.slice(0, 7);
  return `${prefix} (${shortSha}, built ${stamp.builtAt})`;
}

export type StalenessWarningOptions = {
  readonly stamp?: ToolkitBuildStamp | null | undefined;
  readonly cwd?: string | undefined;
  readonly runGit?: GitSyncRunner | undefined;
  readonly isMonorepoRoot?: ((repoRoot: string) => boolean) | undefined;
  readonly writeWarning?: ((line: string) => void) | undefined;
};

function defaultIsMonorepoRoot(repoRoot: string): boolean {
  const check = Bun.spawnSync(
    ["test", "-f", path.join(repoRoot, "packages/toolkit/package.json")],
    { stdout: "ignore", stderr: "ignore" },
  );
  return check.exitCode === 0;
}

function refLagsInstalledStamp(
  repoRoot: string,
  ref: "origin/main" | "HEAD",
  stamp: ToolkitBuildStamp,
  runGit: GitSyncRunner,
): boolean {
  const resolved = runGit(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    repoRoot,
  );
  const refSha = resolved.stdout.trim();
  if (
    resolved.exitCode !== 0 ||
    refSha.length === 0 ||
    refSha === stamp.commit
  ) {
    return false;
  }
  const ancestor = runGit(
    ["merge-base", "--is-ancestor", stamp.commit, ref],
    repoRoot,
  );
  if (ancestor.exitCode !== 0) {
    return false;
  }
  const tree = runGit(
    ["ls-tree", ref, "--", ...TOOLKIT_BUILD_INPUT_PATHS],
    repoRoot,
  );
  return (
    tree.exitCode === 0 &&
    tree.stdout.trim().length > 0 &&
    computeInputTreeDigest(tree.stdout) !== stamp.inputDigest
  );
}

export function warnIfInstalledBinaryStale(
  env: Record<string, string | undefined> = Bun.env,
  options: StalenessWarningOptions = {},
): void {
  const stamp =
    options.stamp === undefined ? embeddedToolkitBuildStamp() : options.stamp;
  if (stamp === null || env["TOOLKIT_NO_STALE_WARNING"] === "1") {
    return;
  }
  const runGit = options.runGit ?? defaultGitSyncRunner;
  const top = runGit(["rev-parse", "--show-toplevel"], options.cwd);
  const repoRoot = top.stdout.trim();
  if (top.exitCode !== 0 || repoRoot.length === 0) {
    return;
  }
  const checkMonorepo = options.isMonorepoRoot ?? defaultIsMonorepoRoot;
  if (!checkMonorepo(repoRoot)) {
    return;
  }
  for (const ref of ["origin/main", "HEAD"] as const) {
    if (!refLagsInstalledStamp(repoRoot, ref, stamp, runGit)) {
      continue;
    }
    const shortSha = stamp.commit.slice(0, 7);
    const builtDate =
      /^\d{4}-\d{2}-\d{2}/u.exec(stamp.builtAt)?.[0] ?? stamp.builtAt;
    const emit =
      options.writeWarning ??
      ((line: string) => {
        console.error(line);
      });
    emit(
      `toolkit: warning: installed binary (${shortSha}, built ${builtDate}) lags ${ref}; run 'bun --cwd packages/toolkit run install:local'`,
    );
    return;
  }
}
