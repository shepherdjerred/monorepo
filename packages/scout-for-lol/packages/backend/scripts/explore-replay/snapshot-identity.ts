import { prisma } from "#src/database/index.ts";
import { REPLAY_WRITABLE_TABLES } from "#src/explore/replay/dataset.ts";

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
 * Row counts were the next attempt and were not enough: a later pull can
 * change a balance or a dare state without moving a count. Naming a handful of
 * tables was the attempt after that, and was not enough either — the agent
 * reads bucks ledgers, reports, competitions, permissions and more, so any
 * list is a list of the tables somebody remembered.
 *
 * So this hashes *every* base table in the schema, discovered from the catalog
 * rather than enumerated, minus the ones a replay itself writes — those change
 * within a sweep by design and `writableRowCounts` covers them with its own
 * message. `hashtext` summed per table is order-independent, so no sort is
 * needed; across 109 tables of the prod snapshot it costs under a fifth of a
 * second.
 */
export async function databaseSnapshotId(): Promise<string> {
  const tables = await prisma.$queryRaw<{ relname: string }[]>`
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `;
  const writable = new Set<string>(REPLAY_WRITABLE_TABLES);
  const identityTables = tables
    .map((row) => row.relname)
    .filter((name) => !writable.has(name));
  if (identityTables.length === 0) {
    throw new Error(
      "The snapshot exposes no tables to fingerprint; it is not a Scout database.",
    );
  }
  const digests = await Promise.all(
    identityTables.map(async (table) => {
      const rows = await prisma.$queryRawUnsafe<{ digest: string }[]>(
        `select coalesce(sum(hashtext(t::text)::bigint), 0)::text as digest from "${table}" t`,
      );
      const digest = rows[0]?.digest;
      if (digest === undefined) {
        throw new Error(`Could not fingerprint ${table}.`);
      }
      return `${table}:${digest}`;
    }),
  );
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(digests.join("\n"));
  return hasher.digest("hex").slice(0, 16);
}
