import type { FleetEnvironment } from "./ports.ts";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export type InheritedWipEvidence = {
  localHeadSha: string;
  status: string;
  stagedDiff: string;
  unstagedDiff: string;
  untrackedDiff: string;
  hasWip: boolean;
  fingerprint: string;
};

async function runGit(
  environment: FleetEnvironment,
  worktree: string,
  signal: AbortSignal,
  args: string[],
): Promise<string> {
  const result = await environment.runLocalCommand({
    executable: "git",
    args,
    cwd: worktree,
    timeoutMs: 30_000,
    signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function collectUntrackedDiff(
  environment: FleetEnvironment,
  worktree: string,
  signal: AbortSignal,
  paths: string[],
): Promise<string> {
  const patches: string[] = [];
  for (const untrackedPath of paths) {
    const result = await environment.runLocalCommand({
      executable: "git",
      args: [
        "diff",
        "--no-index",
        "--binary",
        "--",
        "/dev/null",
        untrackedPath,
      ],
      cwd: worktree,
      timeoutMs: 30_000,
      signal,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `git diff for untracked path ${untrackedPath} failed: ${result.stderr}`,
      );
    }
    patches.push(result.stdout);
  }
  return patches.join("\n");
}

function fingerprint(parts: string[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const part of parts) {
    hasher.update(`${String(Buffer.byteLength(part, "utf8"))}:`);
    hasher.update(part);
  }
  return hasher.digest("hex");
}

export async function collectInheritedWipEvidence(options: {
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
}): Promise<InheritedWipEvidence> {
  const { environment, worktree, signal } = options;
  const localHeadOutput = await runGit(environment, worktree, signal, [
    "rev-parse",
    "HEAD",
  ]);
  const localHeadSha = localHeadOutput.trim();
  const status = await runGit(environment, worktree, signal, [
    "status",
    "--short",
  ]);
  const stagedDiff = await runGit(environment, worktree, signal, [
    "diff",
    "--cached",
    "--binary",
    "--",
  ]);
  const unstagedDiff = await runGit(environment, worktree, signal, [
    "diff",
    "--binary",
    "--",
  ]);
  const untrackedPathsOutput = await runGit(environment, worktree, signal, [
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
  ]);
  const untrackedPaths = untrackedPathsOutput
    .split("\0")
    .filter((value) => value.length > 0);
  const untrackedDiff = await collectUntrackedDiff(
    environment,
    worktree,
    signal,
    untrackedPaths,
  );
  return {
    localHeadSha,
    status,
    stagedDiff,
    unstagedDiff,
    untrackedDiff,
    hasWip:
      status.length > 0 ||
      stagedDiff.length > 0 ||
      unstagedDiff.length > 0 ||
      untrackedDiff.length > 0,
    fingerprint: fingerprint([
      localHeadSha,
      status,
      stagedDiff,
      unstagedDiff,
      untrackedDiff,
    ]),
  };
}

export async function requireCurrentInheritedWipInspection(options: {
  store: FleetStore;
  pr: PrState;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
}): Promise<void> {
  const { store, pr, environment, worktree, signal } = options;
  const context = pr.worktreeContext;
  if (context?.ownership !== "operator") {
    return;
  }
  const live = await collectInheritedWipEvidence({
    environment,
    worktree,
    signal,
  });
  requireMatchingInheritedWipInspection(store, pr, live);
}

export function requireMatchingInheritedWipInspection(
  store: FleetStore,
  pr: PrState,
  live: InheritedWipEvidence,
): void {
  const context = pr.worktreeContext;
  if (context?.ownership !== "operator") {
    return;
  }
  if (live.localHeadSha !== context.localHeadSha) {
    throw new Error(
      "Operator worktree HEAD changed after assignment; inspect again or ask the operator",
    );
  }
  if (!live.hasWip && !context.dirty) {
    return;
  }
  const inspection = store.inheritedWipInspections.get(pr.identity.number);
  if (
    inspection === undefined ||
    !inspection.complete ||
    inspection.remoteHeadSha !== context.remoteHeadSha ||
    inspection.localHeadSha !== live.localHeadSha ||
    inspection.fingerprint !== live.fingerprint
  ) {
    throw new Error(
      "Live operator WIP differs from the complete inspection; inspect again before mutation or publication",
    );
  }
}

export async function recordAuthorizedWipState(options: {
  store: FleetStore;
  pr: PrState;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
}): Promise<void> {
  const { store, pr, environment, worktree, signal } = options;
  const context = pr.worktreeContext;
  if (context?.ownership !== "operator") {
    return;
  }
  const live = await collectInheritedWipEvidence({
    environment,
    worktree,
    signal,
  });
  store.inheritedWipInspections.set(pr.identity.number, {
    remoteHeadSha: context.remoteHeadSha,
    localHeadSha: live.localHeadSha,
    fingerprint: live.fingerprint,
    complete: true,
  });
}
