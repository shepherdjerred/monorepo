import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  crawlSchemaFingerprint,
  INGEST_DAY_PATTERN,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";

/**
 * A build's crawl ledger, `crawl-manifest.json` beside `manifest.json`.
 *
 * It records the crawl schema the build's crawl tables were written at and,
 * per ingest day, the SHA-256 of every raw segment those tables hold. The
 * ledger is what makes the fold idempotent — a segment already listed is
 * never folded twice, even when a fold published and then died before
 * clearing the inbox — and what the nightly rebuild compares against the
 * committed `CrawlSegment` rows to find a day whose inbox file never arrived.
 *
 * Builds share unchanged files by hardlink, so the ledger is always replaced
 * by unlinking and writing a new file, never rewritten in place.
 */

const CRAWL_MANIFEST_FILE = "crawl-manifest.json";

const CrawlManifestSchema = z.strictObject({
  crawlSchemaFingerprint: z.string().min(1),
  days: z.record(
    z.string().regex(INGEST_DAY_PATTERN),
    z.array(z.string().regex(/^[0-9a-f]{64}$/u)),
  ),
});

export type CrawlManifest = z.infer<typeof CrawlManifestSchema>;

export function emptyCrawlManifest(): CrawlManifest {
  return { crawlSchemaFingerprint: crawlSchemaFingerprint(), days: {} };
}

/**
 * The build's crawl ledger, or undefined for a build that has never held crawl
 * data. A ledger that exists but does not parse is a broken internal file and
 * fails the caller: guessing would either fold segments twice or drop them.
 */
export async function readCrawlManifest(
  buildDir: string,
): Promise<CrawlManifest | undefined> {
  const file = Bun.file(path.join(buildDir, CRAWL_MANIFEST_FILE));
  return (await file.exists())
    ? CrawlManifestSchema.parse(await file.json())
    : undefined;
}

export async function writeCrawlManifest(
  buildDir: string,
  manifest: CrawlManifest,
): Promise<void> {
  const target = path.join(buildDir, CRAWL_MANIFEST_FILE);
  // Break the hardlink to the previous build's ledger before writing.
  await rm(target, { force: true });
  const days = Object.fromEntries(
    Object.entries(manifest.days)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([day, segments]) => [day, [...new Set(segments)].toSorted()]),
  );
  await Bun.write(target, JSON.stringify({ ...manifest, days }, null, 2));
}

/** Whether a build's crawl tables can take rows written by this checkout. */
export function crawlManifestIsCurrent(manifest: CrawlManifest): boolean {
  return manifest.crawlSchemaFingerprint === crawlSchemaFingerprint();
}

export function foldedSegments(manifest: CrawlManifest): Set<string> {
  return new Set(Object.values(manifest.days).flat());
}
