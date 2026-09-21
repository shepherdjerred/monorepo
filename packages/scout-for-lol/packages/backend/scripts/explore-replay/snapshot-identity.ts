import { prisma } from "#src/database/index.ts";

/**
 * Tables whose contents identify a snapshot.
 *
 * Deliberately not the ones a replay writes: those change during a sweep by
 * design, and `writableRowCounts` covers them with its own message. These are
 * the rows every answer is computed from and which the runner never touches —
 * it calls `streamExploreAgent` rather than the persisted turn above it.
 */
const IDENTITY_TABLES = [
  "Account",
  "Player",
  "Subscription",
  "ExploreConversation",
  "ExploreMessage",
] as const;

/**
 * What this snapshot contains, as an identity that survives being restored.
 *
 * A replay writes: drafting a dare or preparing a creation persists rows, and
 * nothing rolls them back. The coherence check therefore demands the snapshot
 * be restored between sweeps — and `dev:db-pull` restores by dropping and
 * recreating the database, which assigns a fresh OID every time. An
 * instance-level identity would make a baseline and its candidate look like
 * different datasets after exactly the restore the harness asked for, and the
 * A/B it exists to support could never run twice.
 *
 * Row counts alone were the next attempt and were not enough either: a later
 * pull can change balances, dare states or any other value without moving a
 * count, and two different datasets would have shared an identity. So this
 * hashes the rows themselves — ordered, so the digest does not depend on the
 * order Postgres returns them, and restoring the same dump reproduces it
 * exactly.
 */
export async function databaseSnapshotId(): Promise<string> {
  const digests: string[] = [];
  for (const table of IDENTITY_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ digest: string | null }[]>(
      `select md5(coalesce(string_agg(t.row_text, '|' order by t.row_text), '')) as digest
         from (select "${table}"::text as row_text from "${table}") t`,
    );
    const digest = rows[0]?.digest;
    if (digest === undefined || digest === null) {
      throw new Error(`Could not fingerprint ${table}.`);
    }
    digests.push(`${table}:${digest}`);
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(digests.join("\n"));
  return hasher.digest("hex").slice(0, 16);
}
