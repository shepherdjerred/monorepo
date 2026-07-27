import type { DuckDBValue } from "@duckdb/node-api";
import { z } from "zod";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  buildAccountsSource,
  buildMatchesSource,
  buildPrematchSource,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  MATCH_COLUMNS,
  PREMATCH_COLUMNS,
  type ExplorerColumn,
} from "#src/reports/data-explorer-columns.ts";

const ExplorerTableSchema = z.enum([
  "match_participants",
  "prematch_participants",
]);
const ExplorerOperatorSchema = z.enum(["eq", "contains", "gte", "lte"]);
const ExplorerSortDirectionSchema = z.enum(["asc", "desc"]);

export const ReportDataBrowseInputSchema = z
  .object({
    table: ExplorerTableSchema,
    columns: z.array(z.string().min(1)).min(1).max(80),
    filters: z
      .array(
        z
          .object({
            column: z.string().min(1),
            operator: ExplorerOperatorSchema,
            value: z.string(),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    sort: z
      .object({
        column: z.string().min(1),
        direction: ExplorerSortDirectionSchema,
      })
      .strict()
      .nullable()
      .default(null),
    cursor: z.number().int().nonnegative().nullable().default(null),
    pageSize: z.number().int().min(10).max(50).default(25),
  })
  .strict();

export type ReportDataBrowseInput = z.infer<typeof ReportDataBrowseInputSchema>;

type ExplorerTable = {
  id: z.infer<typeof ExplorerTableSchema>;
  label: string;
  description: string;
  defaultSort: string;
  columns: ExplorerColumn[];
};

const TABLES: ExplorerTable[] = [
  {
    id: "match_participants",
    label: "Match participants",
    description: "One tracked player row per completed match.",
    defaultSort: "game_creation_at",
    columns: MATCH_COLUMNS,
  },
  {
    id: "prematch_participants",
    label: "Prematch participants",
    description: "Tracked players observed in champion select or a lobby.",
    defaultSort: "observed_at",
    columns: PREMATCH_COLUMNS,
  },
];

export function reportDataExplorerSchema(): ExplorerTable[] {
  return TABLES;
}

export async function browseReportData(params: {
  serverId: DiscordGuildId;
  input: ReportDataBrowseInput;
}): Promise<{
  columns: ExplorerColumn[];
  rows: Record<string, string | number | boolean | null>[];
  nextCursor: number | null;
}> {
  const table = requireTable(params.input.table);
  const selectedColumns = params.input.columns.map((id) =>
    requireColumn(table, id),
  );
  const filters = params.input.filters.map((filter) => ({
    column: requireColumn(table, filter.column),
    operator: filter.operator,
    value: filter.value,
  }));
  const sortColumn =
    params.input.sort === null
      ? requireColumn(table, table.defaultSort)
      : requireColumn(table, params.input.sort.column);
  const direction = params.input.sort?.direction ?? "desc";
  const offset = params.input.cursor ?? 0;

  const files = await resolveLakeFiles(resolveLakeDir());
  const source = buildExplorerSource(files, table.id, params.serverId);
  if (source === undefined) {
    return { columns: selectedColumns, rows: [], nextCursor: null };
  }
  const selectList = selectedColumns.map((entry) => entry.id).join(", ");
  const predicate = filterPredicate(filters);
  const where = predicate.sql.length === 0 ? "" : ` WHERE ${predicate.sql}`;
  const sql =
    `SELECT ${selectList} FROM (${source.sql})${where} ` +
    `ORDER BY ${sortColumn.id} ${direction.toUpperCase()} ` +
    `LIMIT ? OFFSET ?`;
  const page = await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      sql,
      bindParams(session, [
        ...source.params,
        ...predicate.params,
        scalarParam(params.input.pageSize + 1),
        scalarParam(offset),
      ]),
    );
    return rows.map((row) => normalizeRow(row, selectedColumns));
  });
  const hasMore = page.length > params.input.pageSize;
  return {
    columns: selectedColumns,
    rows: page.slice(0, params.input.pageSize),
    nextCursor: hasMore ? offset + params.input.pageSize : null,
  };
}

function buildExplorerSource(
  files: LakeFiles,
  table: ExplorerTable["id"],
  serverId: DiscordGuildId,
): SqlFragment | undefined {
  if (files.accountsParquet === undefined) {
    return undefined;
  }
  const rawSource =
    table === "match_participants"
      ? buildMatchesSource(files, { sql: "", params: [] })
      : buildPrematchSource(files, { sql: "", params: [] });
  if (rawSource === undefined) {
    return undefined;
  }
  const accounts = buildAccountsSource(files.accountsParquet, serverId);
  return {
    sql:
      `WITH accounts AS (${accounts.sql}) ` +
      `SELECT a.player_alias, raw.* FROM (${rawSource.sql}) raw ` +
      "JOIN accounts a ON a.puuid = raw.puuid",
    params: [...accounts.params, ...rawSource.params],
  };
}

function filterPredicate(
  filters: {
    column: ExplorerColumn;
    operator: z.infer<typeof ExplorerOperatorSchema>;
    value: string;
  }[],
): SqlFragment {
  const fragments = filters.map((filter) => filterFragment(filter));
  return {
    sql: fragments.map((fragment) => fragment.sql).join(" AND "),
    params: fragments.flatMap((fragment) => fragment.params),
  };
}

function filterFragment(filter: {
  column: ExplorerColumn;
  operator: z.infer<typeof ExplorerOperatorSchema>;
  value: string;
}): SqlFragment {
  if (filter.operator === "contains") {
    if (filter.column.type !== "string") {
      throw new Error("Contains filters require a text column.");
    }
    return {
      sql: `lower(${filter.column.id}) LIKE lower(?)`,
      params: [scalarParam(`%${filter.value}%`)],
    };
  }
  const operator =
    filter.operator === "eq" ? "=" : filter.operator === "gte" ? ">=" : "<=";
  return {
    sql: `${filter.column.id} ${operator} ?`,
    params: [scalarParam(parseFilterValue(filter.column, filter.value))],
  };
}

function parseFilterValue(
  columnInfo: ExplorerColumn,
  value: string,
): string | number {
  if (columnInfo.type === "number") {
    return z.coerce.number().parse(value);
  }
  if (columnInfo.type === "boolean") {
    return z
      .enum(["true", "false"])
      .transform((entry) => (entry === "true" ? 1 : 0))
      .parse(value);
  }
  return value;
}

function normalizeRow(
  raw: unknown,
  columns: ExplorerColumn[],
): Record<string, string | number | boolean | null> {
  const row = z.record(z.string(), z.unknown()).parse(raw);
  return Object.fromEntries(
    columns.map((columnInfo) => [
      columnInfo.id,
      normalizeValue(row[columnInfo.id]),
    ]),
  );
}

/**
 * DuckDB returns TIMESTAMP columns as value objects (DuckDBTimestampValue)
 * carrying epoch microseconds. The class can't be imported statically here —
 * "@duckdb/node-api" is loaded lazily (see duckdb/instance.ts) — so detect the
 * shape structurally instead of via instanceof.
 */
const DuckDBTimestampLikeSchema = z.object({ micros: z.bigint() });

function normalizeValue(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const timestamp = DuckDBTimestampLikeSchema.safeParse(value);
  if (timestamp.success) {
    return new Date(Number(timestamp.data.micros / 1000n)).toISOString();
  }
  throw new Error(`Unsupported report explorer value type: ${typeof value}`);
}

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): DuckDBValue[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

function requireTable(id: ExplorerTable["id"]): ExplorerTable {
  const table = TABLES.find((entry) => entry.id === id);
  if (table === undefined) {
    throw new Error(`Unknown report data table: ${id}`);
  }
  return table;
}

function requireColumn(table: ExplorerTable, id: string): ExplorerColumn {
  const columnInfo = table.columns.find((entry) => entry.id === id);
  if (columnInfo === undefined) {
    throw new Error(`Column ${id} is not available on ${table.id}.`);
  }
  return columnInfo;
}
