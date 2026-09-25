import { prisma } from "#src/database/index.ts";
import { REPLAY_WRITABLE_TABLES } from "#src/explore/replay/dataset.ts";

/**
 * A digest of each table a replay can write into.
 *
 * Explore's dare, challenge and creation tools prepare rather than perform,
 * but preparing persists: a draft, and the single-use confirmation intent that
 * would enact it. Nothing rolls that back between cases, so a sweep leaves the
 * snapshot a little different from the one it started on.
 *
 * The capture records these digests and every run re-takes them, so a sweep
 * cannot silently begin on a snapshot an earlier sweep already wrote into.
 *
 * Digests rather than counts: a later pull can carry a different dare state or
 * a re-used intent at the same row count, and a count would call that the same
 * snapshot. Ordered inside the aggregate so the value does not depend on the
 * order Postgres returns rows.
 */
export async function writableRowCounts(): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const table of REPLAY_WRITABLE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ digest: string | null }[]>(
      `select md5(coalesce(string_agg(t.row_text, '|' order by t.row_text), '')) as digest
         from (select "${table}"::text as row_text from "${table}") t`,
    );
    const digest = rows[0]?.digest;
    if (digest === undefined || digest === null) {
      throw new Error(`Could not fingerprint ${table}.`);
    }
    digests[table] = digest;
  }
  return digests;
}
