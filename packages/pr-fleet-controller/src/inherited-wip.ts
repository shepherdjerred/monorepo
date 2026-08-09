import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { FleetEnvironment } from "./ports.ts";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export type InheritedWipEvidence = {
  localHeadSha: string;
  status: string;
  statusComplete: boolean;
  stagedDiff: string;
  stagedDiffComplete: boolean;
  unstagedDiff: string;
  unstagedDiffComplete: boolean;
  untrackedPaths: string[];
  untrackedPathsComplete: boolean;
  hasWip: boolean;
  fingerprint: string;
};

const MAX_INHERITED_COMMAND_OUTPUT_BYTES = 100_000;
const MAX_UNTRACKED_HASH_BYTES = 10_000_000;

type GitOutput = { output: string; complete: boolean };

async function runGit(
  environment: FleetEnvironment,
  worktree: string,
  signal: AbortSignal,
  args: string[],
): Promise<GitOutput> {
  const result = await environment.runLocalCommand({
    executable: "git",
    args,
    cwd: worktree,
    timeoutMs: 30_000,
    signal,
    sensitiveOutput: true,
    maxOutputBytes: MAX_INHERITED_COMMAND_OUTPUT_BYTES,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return {
    output: result.stdout,
    complete:
      result.stdoutTruncated !== true && result.stderrTruncated !== true,
  };
}

function parseUntrackedPaths(output: GitOutput): string[] {
  const parts = output.output.split("\0");
  if (!output.complete) parts.pop();
  return parts.filter((value) => value.length > 0);
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function fingerprintUntrackedPaths(
  worktree: string,
  untrackedPaths: string[],
): Promise<{ fingerprint: string; complete: boolean }> {
  const root = await realpath(worktree);
  const hasher = new Bun.CryptoHasher("sha256");
  let remainingBytes = MAX_UNTRACKED_HASH_BYTES;
  for (const untrackedPath of untrackedPaths) {
    const absolute = path.resolve(worktree, untrackedPath);
    const parent = await realpath(path.dirname(absolute));
    if (!isWithin(root, parent)) {
      return { fingerprint: hasher.digest("hex"), complete: false };
    }
    const stats = await lstat(absolute);
    hasher.update(`${untrackedPath}\0${String(stats.mode)}\0`);
    if (stats.isSymbolicLink()) {
      hasher.update(`symlink\0${await readlink(absolute)}\0`);
      continue;
    }
    if (!stats.isFile() || stats.size > remainingBytes) {
      return { fingerprint: hasher.digest("hex"), complete: false };
    }
    const resolved = await realpath(absolute);
    if (!isWithin(root, resolved)) {
      return { fingerprint: hasher.digest("hex"), complete: false };
    }
    hasher.update(`file\0${String(stats.size)}\0`);
    for await (const chunk of Bun.file(absolute).stream()) {
      hasher.update(chunk);
    }
    remainingBytes -= stats.size;
  }
  return { fingerprint: hasher.digest("hex"), complete: true };
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
  if (!localHeadOutput.complete) {
    throw new Error("Local HEAD output exceeded its command capture limit");
  }
  const localHeadSha = localHeadOutput.output.trim();
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
  const untrackedPaths = parseUntrackedPaths(untrackedPathsOutput);
  const untrackedContent = await fingerprintUntrackedPaths(
    worktree,
    untrackedPaths,
  );
  return {
    localHeadSha,
    status: status.output,
    statusComplete: status.complete,
    stagedDiff: stagedDiff.output,
    stagedDiffComplete: stagedDiff.complete,
    unstagedDiff: unstagedDiff.output,
    unstagedDiffComplete: unstagedDiff.complete,
    untrackedPaths,
    untrackedPathsComplete:
      untrackedPathsOutput.complete && untrackedContent.complete,
    hasWip:
      status.output.length > 0 ||
      stagedDiff.output.length > 0 ||
      unstagedDiff.output.length > 0 ||
      untrackedPaths.length > 0 ||
      !untrackedPathsOutput.complete,
    fingerprint: fingerprint([
      localHeadSha,
      status.output,
      stagedDiff.output,
      unstagedDiff.output,
      JSON.stringify(untrackedPaths),
      untrackedContent.fingerprint,
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

export function invalidateInheritedWipInspection(options: {
  store: FleetStore;
  pr: PrState;
}): void {
  if (options.pr.worktreeContext?.ownership !== "operator") return;
  options.store.inheritedWipInspections.delete(options.pr.identity.number);
}
