import { mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { accountToLakeRow } from "#src/report-lake/flatten.ts";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import {
  ACCOUNT_LAKE_COLUMNS,
  duckDbColumnsSpec,
} from "#src/report-lake/schema.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { PARQUET_COPY_OPTIONS } from "#src/reports/duckdb/writes/parquet.ts";

const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

export async function writeAccountsParquet(
  prisma: ExtendedPrismaClient,
  buildDir: string,
  abortSignal?: AbortSignal,
): Promise<number> {
  const accounts = await prisma.account.findMany({ include: { player: true } });
  const tmpPath = path.join(buildDir, "accounts.ndjson.tmp");
  abortSignal?.throwIfAborted();
  const writer = new NdjsonFileWriter(tmpPath, undefined, abortSignal);
  try {
    for (const account of accounts)
      await writer.write(accountToLakeRow(account));
    await writer.close();

    const accountsDir = path.join(buildDir, "accounts");
    await mkdir(accountsDir, { recursive: true });
    const parquetPath = path.join(accountsDir, "accounts.parquet");
    try {
      await unlink(parquetPath);
    } catch {
      // A fresh build has no previous hardlink to replace.
    }
    if (accounts.length > 0) {
      await withDuckDBConnection(
        async (session) => {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(ACCOUNT_LAKE_COLUMNS)})) TO '${parquetPath}' (${PARQUET_COPY_OPTIONS})`,
            [tmpPath],
          );
        },
        {
          timeoutMs: COMPACTION_TIMEOUT_MS,
          ...(abortSignal === undefined ? {} : { abortSignal }),
        },
      );
    }
  } finally {
    try {
      await writer.abort();
    } finally {
      await rm(tmpPath, { force: true });
    }
  }
  return accounts.length;
}
