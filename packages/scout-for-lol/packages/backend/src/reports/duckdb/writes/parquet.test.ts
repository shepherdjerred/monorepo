import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { expect, test } from "vitest";
import { PARQUET_COPY_OPTIONS, PARQUET_WRITE_SETTINGS } from "./parquet.ts";

test("writes wide rows across partitions within a small DuckDB budget", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-parquet-"));
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "4",
    memory_limit: "192MB",
    preserve_insertion_order: "false",
    ...PARQUET_WRITE_SETTINGS,
  });
  const connection = await instance.connect();
  try {
    // 256 MiB of wide rows exceeds the entire query budget. Interleaving 12
    // partitions also exercises writer eviction rather than a single file.
    await connection.run(
      `COPY (SELECT i, (i % 12)::VARCHAR AS month, repeat(md5(i::VARCHAR), 256) AS payload FROM range(32768) t(i)) TO '${directory}/rows' (${PARQUET_COPY_OPTIONS}, PARTITION_BY (month))`,
    );
    const rows = await connection.runAndReadAll(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT month) AS months, SUM(i) AS total, SUM(length(payload)) AS bytes, bool_and(payload = repeat(md5(i::VARCHAR), 256)) AS intact FROM read_parquet('${directory}/rows/**/*.parquet', hive_partitioning=true)`,
    );
    expect(rows.getRowObjects()).toEqual([
      {
        count: 32_768n,
        months: 12n,
        total: 536_854_528n,
        bytes: 268_435_456n,
        intact: true,
      },
    ]);
    // Incremental folds use an unpartitioned COPY of the same wide rows.
    await connection.run(
      `COPY (SELECT * FROM read_parquet('${directory}/rows/**/*.parquet', hive_partitioning=true)) TO '${directory}/fold.parquet' (${PARQUET_COPY_OPTIONS})`,
    );
    const folded = await connection.runAndReadAll(
      `SELECT COUNT(*) AS count, SUM(length(payload)) AS bytes, bool_and(payload = repeat(md5(i::VARCHAR), 256)) AS intact FROM read_parquet('${directory}/fold.parquet')`,
    );
    expect(folded.getRowObjects()).toEqual([
      { count: 32_768n, bytes: 268_435_456n, intact: true },
    ]);
  } finally {
    connection.closeSync();
    instance.closeSync();
    await rm(directory, { recursive: true });
  }
});
