import { describe, expect, test } from "bun:test";

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * Phase-0 spike gate for the report-lake DuckDB engine.
 *
 * This suite is the Bun/NAPI canary: it proves @duckdb/node-api loads and
 * behaves under the exact runtime CI uses (oven/bun). If this file goes red,
 * every other duckdb/ module is suspect — fix here first.
 */

const CountRowSchema = z.object({
  n: z.union([z.bigint(), z.number()]).transform(Number),
});

describe("duckdb spike", () => {
  test("loads via dynamic import and answers SELECT 1", async () => {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const reader = await connection.runAndReadAll("SELECT 1 AS n");
    const row = CountRowSchema.parse(reader.getRowObjects()[0]);
    expect(row.n).toBe(1);
    connection.closeSync();
  });

  test("BIGINT aggregates round-trip through Zod to number", async () => {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const reader = await connection.runAndReadAll(
      "SELECT SUM(i)::BIGINT AS n FROM range(1000000) t(i)",
    );
    const raw = reader.getRowObjects()[0];
    expect(typeof z.object({ n: z.bigint() }).parse(raw).n).toBe("bigint");
    const row = CountRowSchema.parse(raw);
    expect(row.n).toBe(499_999_500_000);
    connection.closeSync();
  });

  test("scalar and list parameter binding", async () => {
    const { DuckDBInstance, listValue } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();

    const scalar = await connection.runAndReadAll(
      "SELECT COUNT(*)::BIGINT AS n FROM range(100) t(i) WHERE i < $1",
      [42],
    );
    expect(CountRowSchema.parse(scalar.getRowObjects()[0]).n).toBe(42);

    const list = await connection.runAndReadAll(
      "SELECT COUNT(*)::BIGINT AS n FROM (VALUES ('solo'), ('flex'), ('aram')) v(q) WHERE q IN (SELECT unnest($1))",
      [listValue(["solo", "flex"])],
    );
    expect(CountRowSchema.parse(list.getRowObjects()[0]).n).toBe(2);
    connection.closeSync();
  });

  test("writes and reads parquet + newline-delimited json", async () => {
    const { DuckDBInstance, listValue } = await import("@duckdb/node-api");
    const dir = await mkdtemp(path.join(tmpdir(), "duckdb-spike-"));
    const jsonlPath = path.join(dir, "rows.jsonl");
    const parquetPath = path.join(dir, "rows.parquet");
    await Bun.write(
      jsonlPath,
      '{"match_id":"NA1_1","kills":3}\n{"match_id":"NA1_2","kills":7}\n',
    );

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(
      `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns={match_id:'VARCHAR', kills:'INTEGER'})) TO '${parquetPath}' (FORMAT PARQUET)`,
      [jsonlPath],
    );
    const reader = await connection.runAndReadAll(
      "SELECT SUM(kills)::BIGINT AS n FROM read_parquet($1)",
      [listValue([parquetPath])],
    );
    expect(CountRowSchema.parse(reader.getRowObjects()[0]).n).toBe(10);
    connection.closeSync();
  });

  test("interrupt() cancels a running query", async () => {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const slow = connection.runAndReadAll(
      "SELECT COUNT(*) FROM range(200000000) a, range(50) b",
    );
    setTimeout(() => {
      connection.interrupt();
    }, 50);
    await expect(slow).rejects.toThrow(/interrupt/i);
    connection.closeSync();
  });
});
