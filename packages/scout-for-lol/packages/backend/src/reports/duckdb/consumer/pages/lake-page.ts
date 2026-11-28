import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  withLakeQueryRetry,
  type LakeFiles,
} from "#src/reports/duckdb/lake.ts";

/**
 * One lake slot for one page request.
 *
 * A consumer page reads everything it needs from the lake inside a single
 * `withDuckDBConnection` session, which is itself inside one
 * `withLakeQueryRetry` attempt: one file snapshot and one of the report pool's
 * slots, however many statements the page issues. Readers take the page and
 * never open their own connection; opening one inside a page would wait on the
 * very slot the page already holds.
 */
export type LakePage = {
  readonly files: LakeFiles;
  readonly session: DuckDBSession;
};

export async function withLakePage<T>(
  lakeDir: string | undefined,
  read: (page: LakePage) => Promise<T>,
): Promise<T> {
  return await withLakeQueryRetry(
    lakeDir ?? resolveLakeDir(),
    async (files) =>
      await withDuckDBConnection(
        async (session) => await read({ files, session }),
      ),
  );
}

/**
 * A reader that serves both a whole page and a lone request. Given a `page` it
 * runs on that page's files and session and takes no slot of its own; without
 * one it resolves the lake and takes its own, as it always has, and `session`
 * is `undefined` so each statement opens its own connection.
 */
export async function inLakePage<T>(
  options: { page?: LakePage | undefined; lakeDir?: string | undefined },
  query: (files: LakeFiles, session: DuckDBSession | undefined) => Promise<T>,
): Promise<T> {
  return options.page === undefined
    ? await withLakeQueryRetry(
        options.lakeDir ?? resolveLakeDir(),
        async (files) => await query(files, undefined),
      )
    : await query(options.page.files, options.page.session);
}
