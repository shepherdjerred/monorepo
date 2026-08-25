import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import configuration from "#src/configuration.ts";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { populateCompetitionRankHistoryFromS3 } from "#src/report-lake/rebuild-sources.ts";
import { COMPETITION_RANK_HISTORY_LAKE_COLUMNS } from "@scout-for-lol/data";
import {
  duckDbColumnsSpec,
  duckDbEmptySelect,
} from "#src/report-lake/schema.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { createS3Client } from "#src/storage/s3-client.ts";

const REBUILD_TIMEOUT_MS = 30 * 60 * 1000;

export async function writeCompetitionRankHistoryParquet(options: {
  buildDir: string;
  foldedIds?: Set<string>;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ rows: number; skipped: number }> {
  const { buildDir, foldedIds, abortSignal, timeoutMs } = options;
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw new Error(
      "S3_BUCKET_NAME not configured — cannot materialize competition rank history.",
    );
  }
  const tmpPath = path.join(buildDir, "competition-rank-history.ndjson.tmp");
  const writer = new NdjsonFileWriter(tmpPath);
  const skipped = await populateCompetitionRankHistoryFromS3({
    client: createS3Client(),
    bucket,
    writer,
    ...(foldedIds === undefined ? {} : { foldedIds }),
    ...(abortSignal === undefined ? {} : { abortSignal }),
  });
  await writer.close();

  const outputDir = path.join(buildDir, "competition_rank_history");
  await mkdir(outputDir, { recursive: true });
  const parquetPath = path.join(outputDir, "history.parquet");
  try {
    await unlink(parquetPath);
  } catch {
    // A fresh build has no prior hardlink to replace.
  }
  try {
    await withDuckDBConnection(
      async (session) => {
        if (writer.rows === 0) {
          await session.run(
            `COPY (${duckDbEmptySelect(COMPETITION_RANK_HISTORY_LAKE_COLUMNS)}) TO '${parquetPath}' (FORMAT PARQUET)`,
          );
          return;
        }
        await session.run(
          `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(COMPETITION_RANK_HISTORY_LAKE_COLUMNS)})) TO '${parquetPath}' (FORMAT PARQUET)`,
          [tmpPath],
        );
      },
      { timeoutMs: timeoutMs ?? REBUILD_TIMEOUT_MS },
    );
  } finally {
    await unlink(tmpPath);
  }
  return { rows: writer.rows, skipped };
}
