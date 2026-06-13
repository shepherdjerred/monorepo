/**
 * Git layer for `toolkit deployed`.
 *
 * All reasoning is ancestry-based (never linear `git log` order): bump commits
 * are cut on side branches, so a commit can appear "below" a bump in the log
 * yet not be contained by it. We also locate the bump that *wrote* a given
 * digest by pickaxe (`git log -S<digest>`), because a promoted prod tag (e.g.
 * 2.0.0-2985) can be written into versions.ts by a later build (2.0.0-3016) —
 * the tag number and the writing build differ.
 */
import { $ } from "bun";

export const VERSIONS_PATH = "packages/homelab/src/cdk8s/src/versions.ts";

// Field separator for --format output. Git emits a real NUL byte via %x00; we
// split on it so subjects (which contain spaces) survive intact.
const SEP = String.fromCodePoint(0);

async function git(args: string[]) {
  return $`git ${args}`.nothrow().quiet();
}

async function gitOut(args: string[]): Promise<string | null> {
  const r = await git(args);
  if (r.exitCode !== 0) {
    return null;
  }
  return r.stdout.toString().trim();
}

/** Repo root if we're inside the monorepo (verified by versions.ts presence). */
export async function repoRoot(): Promise<string | null> {
  const root = await gitOut(["rev-parse", "--show-toplevel"]);
  if (root == null || root.length === 0) {
    return null;
  }
  const exists = await Bun.file(`${root}/${VERSIONS_PATH}`).exists();
  return exists ? root : null;
}

/** Best-effort `git fetch origin main` so ancestry checks see the latest bumps. */
export async function fetchMain(): Promise<boolean> {
  const r = await git(["fetch", "origin", "main", "--quiet"]);
  return r.exitCode === 0;
}

export type CommitMeta = { sha: string; shortSha: string; subject: string };

export async function resolveCommit(ref: string): Promise<CommitMeta | null> {
  const out = await gitOut(["log", "-1", "--format=%H%x00%h%x00%s", ref]);
  if (out == null) {
    return null;
  }
  const [sha, shortSha, subject] = out.split(SEP);
  if (sha == null || shortSha == null || subject == null) {
    return null;
  }
  return { sha, shortSha, subject };
}

/** True when `ancestor` is an ancestor of (or equal to) `descendant`. */
export async function isAncestor(
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const r = await git(["merge-base", "--is-ancestor", ancestor, descendant]);
  return r.exitCode === 0;
}

/** Top-level package directories touched by a commit (under packages/). */
export async function changedPackages(ref: string): Promise<string[]> {
  const out = await gitOut([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    ref,
  ]);
  if (out == null || out.length === 0) {
    return [];
  }
  const pkgs = new Set<string>();
  for (const line of out.split("\n")) {
    const m = /^packages\/([^/]+)\//.exec(line);
    if (m?.[1] != null) {
      pkgs.add(m[1]);
    }
  }
  return [...pkgs];
}

/** Latest commit on origin/main that touched a given package directory. */
export async function latestCommitForPackage(
  pkg: string,
): Promise<CommitMeta | null> {
  const sha = await gitOut([
    "log",
    "-1",
    "--format=%H",
    "origin/main",
    "--",
    // ":/" makes the pathspec repo-root-relative, so this works from any subdir.
    `:/packages/${pkg}`,
  ]);
  if (sha == null || sha.length === 0) {
    return null;
  }
  return resolveCommit(sha);
}

/** Raw contents of versions.ts at a given ref. */
export async function showVersionsAt(ref: string): Promise<string | null> {
  return gitOut(["show", `${ref}:${VERSIONS_PATH}`]);
}

/**
 * The most recent commit that introduced `digest` into versions.ts. For a real
 * image this is the "bump image versions" commit; for a seed/placeholder it's
 * the feature commit that first hand-wrote the key.
 */
export async function commitThatWroteDigest(
  digest: string,
): Promise<{ sha: string; subject: string } | null> {
  const out = await gitOut([
    "log",
    "-1",
    "--format=%H%x00%s",
    `-S${digest}`,
    "--",
    `:/${VERSIONS_PATH}`,
  ]);
  if (out == null) {
    return null;
  }
  const [sha, subject] = out.split(SEP);
  if (sha == null || subject == null || sha.length === 0) {
    return null;
  }
  return { sha, subject };
}

const BUMP_SUBJECT = /bump image versions/i;

export function isBumpSubject(subject: string): boolean {
  return BUMP_SUBJECT.test(subject);
}
