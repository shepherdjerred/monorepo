import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance, listValue } from "@duckdb/node-api";
import { expect, test } from "vitest";
import { z } from "zod";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import { PARQUET_WRITE_SETTINGS } from "#src/reports/duckdb/writes/parquet.ts";
import { copyNdjsonToParquet } from "./copy-ndjson.ts";

const SummarySchema = z.object({
  count: z.bigint(),
  total: z.bigint(),
  bytes: z.bigint(),
  intact: z.boolean(),
});

test("bounds wide JSON reads and appends lossless partitioned and folded rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-json-copy-"));
  const instance = await DuckDBInstance.create(":memory:", {
    threads: "4",
    memory_limit: "384MB",
    preserve_insertion_order: "false",
    ...PARQUET_WRITE_SETTINGS,
  });
  const connection = await instance.connect();
  const session: DuckDBSession = {
    run: async (sql, params) => {
      const reader = await connection.runAndReadAll(sql, params);
      return reader.getRowObjects();
    },
    list: (values) => listValue(values),
  };
  try {
    const sourcePath = path.join(directory, "wide.ndjson");
    const writer = Bun.file(sourcePath).writer({ highWaterMark: 1024 * 1024 });
    // Each record is 1 MiB. The previous single COPY exhausts this budget
    // even with the partition/row-group writer settings enabled.
    for (let i = 0; i < 256; i++) {
      const payload = new Bun.CryptoHasher("md5")
        .update(i.toString())
        .digest("hex")
        .repeat(32_768);
      await writer.write(
        `${JSON.stringify({ i, month: (i % 12).toString(), payload })}\n`,
      );
      await writer.flush();
    }
    await writer.end();
    const columns = {
      i: "BIGINT",
      month: "VARCHAR",
      payload: "VARCHAR",
    } as const;

    for (const partitionByMonth of [true, false]) {
      const outputDirectory = path.join(
        directory,
        partitionByMonth ? "partitioned" : "folded'quoted",
      );
      const options = {
        sourcePath,
        outputDirectory,
        columns,
        partitionByMonth,
      };
      await copyNdjsonToParquet(session, options);
      const totals = { count: 0n, total: 0n, bytes: 0n };
      for (const file of new Bun.Glob("**/*.parquet").scanSync({
        cwd: outputDirectory,
        absolute: true,
      })) {
        const [raw] = await session.run(
          "SELECT COUNT(*) AS count, SUM(i) AS total, SUM(length(payload)) AS bytes, bool_and(payload = repeat(md5(i::VARCHAR), 32768)) AS intact FROM read_parquet($1, hive_partitioning=true)",
          [file],
        );
        const row = SummarySchema.parse(raw);
        expect(row.intact).toBe(true);
        totals.count += row.count;
        totals.total += row.total;
        totals.bytes += row.bytes;
      }
      expect(totals).toEqual({
        count: 256n,
        total: 32_640n,
        bytes: 268_435_456n,
      });
      expect(await Bun.file(`${sourcePath}.parquet-batch`).exists()).toBe(
        false,
      );

      // No JS JSON parsing: preserve a BIGINT beyond Number's exact range and
      // multibyte UTF-8 across stream chunks, including an escaped newline.
      const specialPath = path.join(directory, "special.ndjson");
      const payload = `${"雪".repeat(50_000)}🎲\n`;
      await Bun.write(
        specialPath,
        `{"i":9007199254740993,"month":"future","payload":${JSON.stringify(payload)}}`,
      );
      await copyNdjsonToParquet(session, {
        ...options,
        sourcePath: specialPath,
      });
      expect(
        await session.run(
          "SELECT i, payload FROM read_parquet($1, hive_partitioning=true) WHERE i = $2",
          [path.join(outputDirectory, "**/*.parquet"), 9_007_199_254_740_993n],
        ),
      ).toEqual([{ i: 9_007_199_254_740_993n, payload }]);
      const [count] = await session.run(
        "SELECT COUNT(*) AS count FROM read_parquet($1, hive_partitioning=true)",
        [path.join(outputDirectory, "**/*.parquet")],
      );
      expect(count).toEqual({ count: 257n });
    }

    const badSource = path.join(directory, "malformed.ndjson");
    await Bun.write(badSource, "{broken\n");
    await expect(
      copyNdjsonToParquet(session, {
        sourcePath: badSource,
        outputDirectory: path.join(directory, "invalid"),
        columns,
        partitionByMonth: true,
      }),
    ).rejects.toThrow("Parquet COPY failed for malformed.ndjson");
    expect(await Bun.file(badSource).text()).toBe("{broken\n");
    expect(await Bun.file(`${badSource}.parquet-batch`).exists()).toBe(false);
  } finally {
    connection.closeSync();
    instance.closeSync();
    await rm(directory, { recursive: true });
  }
});
