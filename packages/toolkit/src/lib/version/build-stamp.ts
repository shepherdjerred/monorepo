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

export function defaultGitSyncRunner(
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
