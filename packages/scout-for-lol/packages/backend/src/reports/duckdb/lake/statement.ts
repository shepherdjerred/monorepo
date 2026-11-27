import type { z } from "zod";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import type { BoundParam, SqlFragment } from "#src/reports/duckdb/lake.ts";

/**
 * Running one lake statement. This is a leaf: it imports no lake reader, so
 * every reader, page and consumer can use it without an import cycle.
 */

/** Bind a lake query's parameters for one session. */
export function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

/**
 * Run `sql` over a built source and parse every row with `schema`. The
 * source's parameters sit between `leadingParams` and `trailingParams`. Given
 * a `session` it runs on that connection and takes no slot of its own;
 * without one it opens a connection for the statement.
 */
export async function runSource<T>(options: {
  source: SqlFragment;
  sql: string;
  leadingParams?: BoundParam[];
  trailingParams?: BoundParam[];
  schema: z.ZodType<T>;
  abortSignal?: AbortSignal | undefined;
  /** Run on this connection instead of taking a slot of its own. */
  session?: DuckDBSession | undefined;
}): Promise<T[]> {
  const run = async (session: DuckDBSession): Promise<T[]> => {
    const rows = await session.run(
      options.sql,
      bindParams(session, [
        ...(options.leadingParams ?? []),
        ...options.source.params,
        ...(options.trailingParams ?? []),
      ]),
    );
    return rows.map((row) => options.schema.parse(row));
  };
  if (options.session !== undefined) return await run(options.session);
  return await withDuckDBConnection(
    run,
    options.abortSignal === undefined
      ? {}
      : { abortSignal: options.abortSignal },
  );
}
