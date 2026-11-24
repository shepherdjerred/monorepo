import path from "node:path";

declare const TOOLKIT_BUILD_COMMIT: string | undefined;
declare const TOOLKIT_BUILD_INPUT_DIGEST: string | undefined;
declare const TOOLKIT_BUILT_AT: string | undefined;

export const TOOLKIT_BUILD_INPUT_PATHS = [
  "packages/toolkit",
  "packages/delivery",
  "packages/ops-model",
  "packages/tracker",
  "packages/code-review",
  "packages/version-catalog",
  "packages/config",
  "packages/llm-models",
  "packages/unix-socket-daemon",
  "packages/mc-harness",
] as const;

export type ToolkitBuildStamp = {
  readonly commit: string;
  readonly inputDigest: string;
  readonly builtAt: string;
};

export type GitSyncRunner = (
  args: readonly string[],
  cwd?: string,
) => { readonly exitCode: number; readonly stdout: string };

function defaultGitSyncRunner(
  args: readonly string[],
  cwd?: string,
): { readonly exitCode: number; readonly stdout: string } {
  try {
    const proc = Bun.spawnSync(["git", ...args], {
      ...(cwd === undefined ? {} : { cwd }),
      stdout: "pipe",
      stderr: "ignore",
    });
    return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
  } catch {
    return { exitCode: 1, stdout: "" };
  }
}

export function computeInputTreeDigest(lsTreeOutput: string): string {
  return new Bun.CryptoHasher("sha256")
    .update(lsTreeOutput.trim())
    .digest("hex");
}

export function buildDefineFlags(
  stamp?: ToolkitBuildStamp | null,
): readonly string[] {
  if (stamp == null) {
    return [];
  }
  return [
    "--define",
    `TOOLKIT_BUILD_COMMIT=${JSON.stringify(stamp.commit)}`,
    "--define",
    `TOOLKIT_BUILD_INPUT_DIGEST=${JSON.stringify(stamp.inputDigest)}`,
    "--define",
    `TOOLKIT_BUILT_AT=${JSON.stringify(stamp.builtAt)}`,
  ];
}

export function resolveToolkitBuildStamp(
  cwd: string,
  options: {
    readonly now?: Date | undefined;
    readonly runGit?: GitSyncRunner | undefined;
  } = {},
): ToolkitBuildStamp | null {
  const runGit = options.runGit ?? defaultGitSyncRunner;
  const topRes = runGit(["rev-parse", "--show-toplevel"], cwd);
  const repoRoot = topRes.stdout.trim();
  if (topRes.exitCode !== 0 || repoRoot.length === 0) {
    return null;
  }
  const headRes = runGit(["rev-parse", "HEAD"], repoRoot);
  const commit = headRes.stdout.trim();
  if (headRes.exitCode !== 0 || commit.length === 0) {
    return null;
  }
  const treeRes = runGit(
    ["ls-tree", "HEAD", "--", ...TOOLKIT_BUILD_INPUT_PATHS],
    repoRoot,
  );
  if (treeRes.exitCode !== 0 || treeRes.stdout.trim().length === 0) {
    return null;
  }
  return {
    commit,
    inputDigest: computeInputTreeDigest(treeRes.stdout),
    builtAt: (options.now ?? new Date()).toISOString(),
  };
}

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
