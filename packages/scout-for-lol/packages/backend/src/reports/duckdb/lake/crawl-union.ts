import type { DuckDbColumnType } from "@scout-for-lol/data";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import {
  crawlFilePaths,
  type CrawlFile,
} from "#src/reports/duckdb/lake/crawl-files.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake/files.ts";
import type {
  LakeBoundParam as BoundParam,
  LakeSqlFragment as SqlFragment,
} from "#src/reports/duckdb/lake/sql-fragment-types.ts";
import {
  includesCrawl,
  type LakePopulation,
} from "#src/reports/duckdb/lake/population.ts";

/**
 * The crawl branch of a lake source, and how it joins the tracked one.
 *
 * For the `all` population a source is the tracked relation (parquet ∪
 * staging, deduped exactly as before) UNION ALL BY NAME the crawl table's
 * rows. Two rules make that union correct and cheap:
 *
 * - **No dedupe window on the crawl branch.** The crawl stores a match once
 *   (`CrawlMatch` is keyed by match id and the fold's ledger never folds a
 *   segment twice), so its rows are already unique per key; a window over
 *   millions of crawl rows would cost memory for nothing.
 * - **A tracked match always wins.** The crawl can fetch a match Scout also
 *   tracks (it seeds from tracked games' participants). The crawl branch is
 *   anti-joined on `match_id` against every tracked match id — unfiltered, so
 *   a tracked match the query's predicate excludes is not read back from the
 *   crawl instead — and a game is never counted twice.
 *
 * Columns the crawl table lacks (the reduced timeline's frame fields, the
 * tracked timeline's partitioning) read as NULL, and the predicate is applied
 * over that projection so it may name them.
 *
 * `provenance` ('tracked' or 'crawl') is a constant added per branch: always
 * for `all`, and for `tracked` only when the read asks for it, so a tracked
 * read that does not name it compiles to exactly the SQL it did before.
 */

export type SourceOptions = {
  population?: LakePopulation | undefined;
  /** Add the `provenance` column ('tracked' | 'crawl'). */
  provenance?: boolean | undefined;
};

/** Every tracked match id, parquet and staging, for the crawl anti-join. */
function trackedMatchKeys(files: LakeFiles): SqlFragment | undefined {
  const branches: string[] = [];
  const params: BoundParam[] = [];
  if (files.matchesParquet.length > 0) {
    branches.push("SELECT match_id FROM read_parquet(?)");
    params.push({ kind: "list", values: files.matchesParquet });
  }
  if (files.matchesStaging.length > 0) {
    branches.push(
      `SELECT match_id FROM read_json(?, format='newline_delimited', columns=${duckDbColumnsSpec({ match_id: "VARCHAR" })})`,
    );
    params.push({ kind: "list", values: files.matchesStaging });
  }
  return branches.length === 0
    ? undefined
    : { sql: branches.join(" UNION "), params };
}

function crawlProjection(
  columns: Readonly<Record<string, DuckDbColumnType>>,
  available: Readonly<Record<string, DuckDbColumnType>>,
): string {
  return Object.entries(columns)
    .map(([name, type]) =>
      name in available ? name : `CAST(NULL AS ${type}) AS ${name}`,
    )
    .join(", ");
}

function crawlBranch(input: {
  files: LakeFiles;
  crawlFiles: readonly CrawlFile[];
  columns: Readonly<Record<string, DuckDbColumnType>>;
  crawlColumns: Readonly<Record<string, DuckDbColumnType>>;
  predicate: SqlFragment;
}): SqlFragment {
  const where =
    input.predicate.sql.length > 0 ? ` WHERE ${input.predicate.sql}` : "";
  const rows = `SELECT * FROM (SELECT ${crawlProjection(input.columns, input.crawlColumns)}, 'crawl' AS provenance FROM read_parquet(?, hive_partitioning = false))${where}`;
  const rowParams: BoundParam[] = [
    { kind: "list", values: crawlFilePaths(input.crawlFiles) },
    ...input.predicate.params,
  ];
  const keys = trackedMatchKeys(input.files);
  if (keys === undefined) return { sql: rows, params: rowParams };
  return {
    sql: `SELECT c.* FROM (${rows}) c ANTI JOIN (${keys.sql}) k ON c.match_id = k.match_id`,
    params: [...rowParams, ...keys.params],
  };
}

/**
 * The tracked source for `options.population`, with the crawl branch and
 * `provenance` added as the options ask. Returns `tracked` unchanged for a
 * tracked read that does not ask for `provenance`.
 */
export function withPopulation(input: {
  files: LakeFiles;
  tracked: SqlFragment | undefined;
  crawl: {
    files: readonly CrawlFile[];
    columns: Readonly<Record<string, DuckDbColumnType>>;
  };
  columns: Readonly<Record<string, DuckDbColumnType>>;
  predicate: SqlFragment;
  options: SourceOptions;
}): SqlFragment | undefined {
  const all = includesCrawl(input.options.population);
  if (!all && input.options.provenance !== true) return input.tracked;
  const branches: SqlFragment[] = [];
  if (input.tracked !== undefined) {
    branches.push({
      sql: `SELECT *, 'tracked' AS provenance FROM (${input.tracked.sql})`,
      params: input.tracked.params,
    });
  }
  if (all && input.crawl.files.length > 0) {
    branches.push(
      crawlBranch({
        files: input.files,
        crawlFiles: input.crawl.files,
        columns: input.columns,
        crawlColumns: input.crawl.columns,
        predicate: input.predicate,
      }),
    );
  }
  const [first, second] = branches;
  if (first === undefined) return undefined;
  if (second === undefined) return first;
  return {
    sql: `${first.sql} UNION ALL BY NAME ${second.sql}`,
    params: [...first.params, ...second.params],
  };
}
