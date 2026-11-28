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
