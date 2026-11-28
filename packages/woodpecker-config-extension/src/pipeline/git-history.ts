/**
 * Shallow history shared by the golden workspace and the steps that clone it.
 *
 * A workspace is a ZFS clone of the golden, so every byte a step writes that
 * the golden already holds becomes a new write on the CI node. The history
 * fetches below used to write about 1.5 GB per workspace for exactly that
 * reason: the checkout leaves `HEAD` as a depth-one commit, so Git's
 * negotiation advertised no ancestors and the server re-sent every blob the
 * last `SHALLOW_HISTORY_DEPTH` commits changed. The golden now holds that
 * history under a named ref, which negotiation does find.
 */

/** Commits of history a verification workspace fetches for changed-file bases. */
export const SHALLOW_HISTORY_DEPTH = 100;

/**
 * Turn off automatic repacking in this workspace's own repository.
 *
 * A fetch otherwise runs `git maintenance run --auto` detached, which writes a
 * commit graph and multi-pack index and may repack. The workspace is
 * discarded when the step ends, so none of that is ever read back.
 */
export const GIT_MAINTENANCE_OFF = [
  "git config gc.auto 0",
  "git config maintenance.auto false",
] as const;

/**
 * Give the golden workspace the same history its clones fetch, and name it.
 *
 * The fetch is by commit: main may already have moved past the commit this
 * golden was built from. The remote-tracking ref is what lets a clone's
 * fetch negotiate against these objects. Garbage collection then drops what an
 * earlier generation's boundary left unreachable, so the golden stays one pack
 * of exactly the current history rather than growing with every refresh.
 * Automatic maintenance is switched off first (see `GIT_MAINTENANCE_OFF`) so
 * the clones inherit that setting; the explicit `gc` below is unaffected.
 */
export function goldenHistoryCommands(): string[] {
  return [
    // Stored in the golden's own config, which every clone copies, so a clone
    // never starts a maintenance run on its first fetch either.
    ...GIT_MAINTENANCE_OFF,
    `git fetch --no-tags --depth=${SHALLOW_HISTORY_DEPTH.toString()} origin "$(git rev-parse HEAD)"`,
    'git update-ref "refs/remotes/origin/$CI_REPO_DEFAULT_BRANCH" HEAD',
    "git reflog expire --expire=now --all",
    "git gc --prune=now --quiet",
  ];
}
