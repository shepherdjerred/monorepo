/**
 * Size budgets for the committed snapshot v2 files, one class per file kind.
 * Shared by the refresh (which refuses to write over budget) and
 * `scripts/check-asset-sizes.ts` (which checks what is committed), so the two
 * cannot drift. Plain constants with no imports: the script reads this file
 * directly.
 *
 * The matchup files are the many small ones: a static matchup page loads one
 * of them, so a single file stays small whatever the total. The totals are a
 * first sizing for the crawl at about 20,000 matches a day and are re-sized
 * from the first measured production snapshot.
 */

const KIB = 1024;
const MIB = 1024 * KIB;

export const SNAPSHOT_V2_DIRECTORY = "src/data/generated/champion-meta";

export const SNAPSHOT_V2_BUDGET = {
  index: { maxBytes: 256 * KIB },
  champion: { maxBytes: 256 * KIB, totalMaxBytes: 24 * MIB },
  matchup: { maxBytes: 16 * KIB, totalMaxBytes: 48 * MIB },
} as const;

export type SnapshotV2FileClass = keyof typeof SNAPSHOT_V2_BUDGET;

/**
 * The most files one refresh may add, change or remove. The weekly refresh
 * commits the snapshot through a pull request, and GitHub's pull request files
 * API stops at 3,000 files, so a larger change set could not be reviewed or
 * pass the review gate. Past this the refresh fails rather than truncating.
 */
export const SNAPSHOT_V2_MAX_CHANGED_FILES = 2500;

/** Tracker issue holding the design of the move off committing the snapshot. */
export const SNAPSHOT_V2_GUARD_ISSUE = "AI-1031";

/** Tail of every guard error: what tripped it means the snapshot has outgrown Git. */
export const SNAPSHOT_V2_GUARD_HINT = `The snapshot has outgrown being committed to Git. ${SNAPSHOT_V2_GUARD_ISSUE} plan (b) is the move: publish each snapshot as a content-addressed bundle to object storage and commit only a pointer, with the build fetching and verifying the bundle. Nothing was written.`;

/** Present in every guard error so the Temporal activity can refuse to retry it. */
export const SNAPSHOT_V2_GUARD_MARKER = "champion-meta-snapshot-guard";
