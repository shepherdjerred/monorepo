import { prisma } from "#src/database/index.ts";

/**
 * Where a lake read learns which erased players' matches it must still hide.
 *
 * PostgreSQL is the source: the erasure request writes `ErasedPuuid` and no
 * lake file, so reading it here is what makes an erasure take effect at once.
 * A hash leaves the set when a published build no longer holds the player
 * (`report-lake/crawl/crawl-erasure-step.ts`). The set is small; it is read
 * once per query attempt, and only for a build that has crawl files.
 */
export type CrawlTombstoneSource = () => Promise<readonly string[]>;

const fromPostgres: CrawlTombstoneSource = async () => {
  const rows = await prisma.erasedPuuid.findMany({
    where: { lakeErasedAt: null },
    select: { puuidHash: true },
    orderBy: { puuidHash: "asc" },
  });
  return rows.map((row) => row.puuidHash);
};

let source: CrawlTombstoneSource = fromPostgres;

export async function loadCrawlTombstones(): Promise<readonly string[]> {
  return await source();
}

/**
 * Serve tombstones from `replacement` until the returned function restores
 * PostgreSQL. For DuckDB-only tests of crawl reads, which have no database.
 */
export function replaceCrawlTombstoneSourceForTests(
  replacement: CrawlTombstoneSource,
): () => void {
  source = replacement;
  return () => {
    source = fromPostgres;
  };
}
