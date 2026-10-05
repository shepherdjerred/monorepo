import { rm } from "node:fs/promises";
import path from "node:path";
import type { FileSink } from "bun";
import type { DuckDbColumnType } from "@scout-for-lol/data";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import { PARQUET_COPY_OPTIONS } from "#src/reports/duckdb/writes/parquet.ts";

const COPY_BATCH_BYTES = 64 * 1024 * 1024;
const DISK_BUFFER_BYTES = 1024 * 1024;

type EncodedRecord = { pieces: Uint8Array[]; bytes: number };

/** Preserve encoded records, including UTF-8 and numeric precision. */
async function* ndjsonRecords(
  sourcePath: string,
): AsyncGenerator<EncodedRecord> {
  const reader = Bun.file(sourcePath).stream().getReader();
  let pieces: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      const { value } = chunk;
      let offset = 0;
      while (offset < value.byteLength) {
        const newline = value.indexOf(10, offset);
        const end = newline === -1 ? value.byteLength : newline + 1;
        const piece = value.subarray(offset, end);
        pieces.push(piece);
        bytes += piece.byteLength;
        offset = end;
        if (newline !== -1) {
          yield { pieces, bytes };
          pieces = [];
          bytes = 0;
        }
      }
    }
    if (bytes > 0) yield { pieces, bytes };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/**
 * Bound JSON input before DuckDB materializes a vector of wide documents.
 * Row groups and partition flush thresholds only bound the downstream writer.
 * Each COPY reads at most 64 MiB, except for one oversized record. APPEND
 * creates unique output files so successive batches retain every prior row.
 */
export async function copyNdjsonToParquet(
  session: DuckDBSession,
  options: {
    sourcePath: string;
    outputDirectory: string;
    columns: Record<string, DuckDbColumnType>;
    partitionByMonth: boolean;
    fileNamePrefix?: string;
  },
): Promise<void> {
  const batchPath = `${options.sourcePath}.parquet-batch`;
  if (await Bun.file(batchPath).exists()) {
    throw new Error(`Parquet COPY batch already exists: ${batchPath}`);
  }
  let writer: FileSink | undefined;
  let batchBytes = 0;
  let bufferedBytes = 0;
  let batch = 0;

  const copyBatch = async () => {
    if (writer === undefined) return;
    const sink = writer;
    writer = undefined;
    await sink.end();
    batch++;
    const layout = options.partitionByMonth
      ? "PARTITION_BY (month), APPEND"
      : "PER_THREAD_OUTPUT, APPEND";
    const directory = options.outputDirectory.replaceAll("'", "''");
    const pattern = `${options.fileNamePrefix ?? "data"}_{uuid}`.replaceAll(
      "'",
      "''",
    );
    try {
      await session.run(
        `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(options.columns)})) TO '${directory}' (${PARQUET_COPY_OPTIONS}, ${layout}, FILENAME_PATTERN '${pattern}')`,
        [batchPath],
      );
    } catch (error) {
      throw new Error(
        `Parquet COPY failed for ${path.basename(options.sourcePath)} (batch ${batch.toString()}, ${batchBytes.toString()} bytes)`,
        { cause: error },
      );
    }
    await rm(batchPath);
    batchBytes = 0;
    bufferedBytes = 0;
  };

  try {
    for await (const record of ndjsonRecords(options.sourcePath)) {
      if (batchBytes > 0 && batchBytes + record.bytes > COPY_BATCH_BYTES) {
        await copyBatch();
      }
      writer ??= Bun.file(batchPath).writer({
        highWaterMark: DISK_BUFFER_BYTES,
      });
      for (const piece of record.pieces) {
        await writer.write(piece);
        bufferedBytes += piece.byteLength;
        if (bufferedBytes >= DISK_BUFFER_BYTES) {
          await writer.flush();
          bufferedBytes = 0;
        }
      }
      batchBytes += record.bytes;
      if (batchBytes >= COPY_BATCH_BYTES) await copyBatch();
    }
    await copyBatch();
  } finally {
    try {
      await writer?.end();
    } finally {
      await rm(batchPath, { force: true });
    }
  }
}
