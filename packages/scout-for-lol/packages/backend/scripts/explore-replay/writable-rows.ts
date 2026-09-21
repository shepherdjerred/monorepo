import { prisma } from "#src/database/index.ts";
import { REPLAY_WRITABLE_TABLES } from "#src/explore/replay/dataset.ts";

/**
 * What the tables a replay can write into hold right now.
 *
 * Explore's dare, challenge and creation tools prepare rather than perform,
 * but preparing persists: a draft, and the single-use confirmation intent that
 * would enact it. Nothing rolls that back between cases, so a sweep leaves the
 * snapshot a little different from the one it started on.
 *
 * The capture records these counts and every run re-takes them, so a sweep
 * cannot silently begin on a snapshot an earlier sweep already wrote into.
 * Counted through a raw query keyed by the shared table list, so adding a
 * table needs no second edit.
 */
export async function writableRowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of REPLAY_WRITABLE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::bigint as count from "${table}"`,
    );
    const count = rows[0]?.count;
    if (count === undefined) {
      throw new Error(`Could not count rows in ${table}.`);
    }
    counts[table] = Number(count);
  }
  return counts;
}
