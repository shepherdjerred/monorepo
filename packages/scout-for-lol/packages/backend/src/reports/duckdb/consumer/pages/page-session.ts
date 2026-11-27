import type { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  withLakeQueryRetry,
  type BoundParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/**
 * One lake slot per page: every statement a page reads runs in this single
 * DuckDB session, inside one lake snapshot. The lake's report pool has two
 * slots shared with Explore and reports, so a page that opened a connection
 * per statement would queue behind itself.
 */
export type PageLakeSession = {
  files: LakeFiles;
  /** Run one statement of the page; the source's parameters sit between the two lists. */
  run: <T>(statement: {
    source: SqlFragment;
    sql: string;
    leadingParams?: BoundParam[];
    trailingParams?: BoundParam[];
    schema: z.ZodType<T>;
  }) => Promise<T[]>;
};

export async function withPageLakeSession<T>(
  lakeDir: string | undefined,
  page: (session: PageLakeSession) => Promise<T>,
): Promise<T> {
  return await withLakeQueryRetry(
    lakeDir ?? resolveLakeDir(),
    async (files) =>
      await withDuckDBConnection(async (duckdb: DuckDBSession) => {
        return await page({
          files,
          run: async (statement) => {
            const rows = await duckdb.run(
              statement.sql,
              bindParams(duckdb, [
                ...(statement.leadingParams ?? []),
                ...statement.source.params,
                ...(statement.trailingParams ?? []),
              ]),
            );
            return rows.map((row) => statement.schema.parse(row));
          },
        });
      }),
  );
}
