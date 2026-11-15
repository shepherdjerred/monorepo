import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { copyNdjsonToParquet } from "#src/report-lake/parquet/copy-ndjson.ts";
import {
  CRAWL_LAKE_TABLE_COLUMNS,
  CRAWL_LAKE_TABLES,
  ingestDayDirName,
  type CrawlLakeTable,
  type CrawlTableRows,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";

const CRAWL_WRITE_TIMEOUT_MS = 30 * 60 * 1000;

export type CrawlRowCounts = Record<CrawlLakeTable, number>;

export function zeroCrawlRowCounts(): CrawlRowCounts {
  return {
    matches_crawl: 0,
    match_teams_crawl: 0,
    match_team_bans_crawl: 0,
    timeline_events_crawl: 0,
    timeline_event_participants_crawl: 0,
  };
}

export function sumCrawlRowCounts(
  ...counts: readonly CrawlRowCounts[]
): CrawlRowCounts {
  const total = zeroCrawlRowCounts();
  for (const count of counts) {
    for (const table of CRAWL_LAKE_TABLES) total[table] += count[table];
  }
  return total;
}

export function crawlDayDir(
  buildDir: string,
  table: CrawlLakeTable,
  day: string,
): string {
  return path.join(buildDir, table, ingestDayDirName(day));
}

/**
 * Streams crawl rows to one NDJSON temporary file per (table, ingest day),
 * then converts each to Parquet files in `<table>/ingest_day=<day>/` named
 * with `filePrefix`. Rows are never held in memory beyond the writer's
 * bounded buffer, so a large day rebuild costs disk, not heap.
 */
export class CrawlParquetWriter {
  readonly #writers = new Map<
    string,
    { table: CrawlLakeTable; day: string; writer: NdjsonFileWriter }
  >();

  constructor(
    private readonly buildDir: string,
    private readonly filePrefix: string,
    private readonly abortSignal?: AbortSignal,
  ) {}

  async add(day: string, rows: CrawlTableRows): Promise<void> {
    for (const table of CRAWL_LAKE_TABLES) {
      const tableRows = rows[table];
      if (tableRows.length === 0) continue;
      const writer = this.#writerFor(table, day);
      for (const row of tableRows) await writer.write(row);
    }
  }

  #writerFor(table: CrawlLakeTable, day: string): NdjsonFileWriter {
    const key = `${table}/${day}`;
    const existing = this.#writers.get(key);
    if (existing !== undefined) return existing.writer;
    const file = path.join(
      this.buildDir,
      `${table}-${day}-${this.filePrefix}.ndjson.tmp`,
    );
    const writer = new NdjsonFileWriter(file, undefined, this.abortSignal);
    this.#writers.set(key, { table, day, writer });
    return writer;
  }

  /** Write every buffered (table, day) as Parquet; returns rows per table. */
  async finish(): Promise<CrawlRowCounts> {
    const counts = zeroCrawlRowCounts();
    try {
      for (const { writer } of this.#writers.values()) await writer.close();
      if (this.#writers.size === 0) return counts;
      await withMaintenanceDuckDBConnection(
        async (session) => {
          for (const { table, day, writer } of this.#writers.values()) {
            const outputDirectory = crawlDayDir(this.buildDir, table, day);
            await mkdir(outputDirectory, { recursive: true });
            await copyNdjsonToParquet(session, {
              sourcePath: writer.filePath,
              outputDirectory,
              columns: CRAWL_LAKE_TABLE_COLUMNS[table],
              partitionByMonth: false,
              fileNamePrefix: this.filePrefix,
            });
            counts[table] += writer.rows;
          }
        },
        {
          timeoutMs: CRAWL_WRITE_TIMEOUT_MS,
          ...(this.abortSignal === undefined
            ? {}
            : { abortSignal: this.abortSignal }),
        },
      );
      return counts;
    } finally {
      await this.abort();
    }
  }

  /** Drop every temporary file; safe to call more than once. */
  async abort(): Promise<void> {
    for (const { writer } of this.#writers.values()) {
      await writer.abort();
      await rm(writer.filePath, { force: true });
    }
  }
}
