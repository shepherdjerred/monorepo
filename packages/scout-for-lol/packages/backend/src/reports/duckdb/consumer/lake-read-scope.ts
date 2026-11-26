import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import {
  withLakeQueryRetry,
  type LakeFiles,
} from "#src/reports/duckdb/lake.ts";

/**
 * The lake files and the one report-pool connection a page's reads share. A
 * reader given a scope runs on it and takes no slot of its own; one without
 * resolves the lake and takes its own slot, as it always has.
 */
export type LakeReadScope = { files: LakeFiles; session: DuckDBSession };

export async function inLakeScope<T>(
  options: { scope?: LakeReadScope | undefined; lakeDir?: string | undefined },
  query: (files: LakeFiles, session: DuckDBSession | undefined) => Promise<T>,
): Promise<T> {
  return options.scope === undefined
    ? await withLakeQueryRetry(
        options.lakeDir ?? resolveLakeDir(),
        async (files) => await query(files, undefined),
      )
    : await query(options.scope.files, options.scope.session);
}
