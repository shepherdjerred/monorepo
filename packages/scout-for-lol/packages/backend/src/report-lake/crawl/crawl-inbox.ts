import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * The crawl inbox: `<lakeDir>/crawl-inbox/`.
 *
 * The crawl Activity drops each committed raw segment here (the same zstd
 * NDJSON bytes it wrote to `crawl/v1/`), and the lake fold turns the inbox
 * into crawl-table Parquet. The activity-worker pod writes and the
 * application pod folds, on the shared lake volume, so a file appears only
 * through `rename(2)` of a finished temporary file and the fold never reads a
 * partial segment. The file name carries the segment's ingest day and its
 * SHA-256, so a repeated write is a no-op and the fold can check integrity.
 */

const CRAWL_INBOX_DIR = "crawl-inbox";
const INBOX_FILE = /^(\d{4}-\d{2}-\d{2})_([0-9a-f]{64})\.ndjson\.zst$/u;

export type CrawlInboxSegment = {
  file: string;
  dt: string;
  sha256: string;
};

export function crawlInboxDir(lakeDir: string): string {
  return path.join(lakeDir, CRAWL_INBOX_DIR);
}

export async function writeCrawlInboxSegment(
  lakeDir: string,
  segment: { sha256: string; dt: string; bytes: Uint8Array },
): Promise<void> {
  const directory = crawlInboxDir(lakeDir);
  const name = `${segment.dt}_${segment.sha256}.ndjson.zst`;
  if (!INBOX_FILE.test(name)) {
    throw new Error(`Not a crawl segment name: ${name}`);
  }
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  if (await Bun.file(target).exists()) return;
  const temporary = path.join(directory, `.${name}.${crypto.randomUUID()}.tmp`);
  try {
    await Bun.write(temporary, segment.bytes);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Finished inbox segments, oldest day first; temporary files are not listed. */
export async function listCrawlInbox(
  lakeDir: string,
): Promise<CrawlInboxSegment[]> {
  let names: string[];
  try {
    names = await readdir(crawlInboxDir(lakeDir));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return names
    .flatMap((name) => {
      const match = INBOX_FILE.exec(name);
      if (match?.[1] === undefined || match[2] === undefined) return [];
      return [
        {
          file: path.join(crawlInboxDir(lakeDir), name),
          dt: match[1],
          sha256: match[2],
        },
      ];
    })
    .toSorted((left, right) => left.file.localeCompare(right.file));
}

export async function removeCrawlInboxSegments(
  segments: readonly CrawlInboxSegment[],
): Promise<void> {
  for (const segment of segments) {
    await rm(segment.file, { force: true });
  }
}
