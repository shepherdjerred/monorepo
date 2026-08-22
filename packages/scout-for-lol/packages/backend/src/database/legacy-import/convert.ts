/**
 * Value conversion between the legacy SQLite storage formats and the Prisma
 * Postgres client, plus the erased per-model spec the importer iterates.
 *
 * Legacy storage (via the old libsql adapter with
 * `timestampFormat: "unixepoch-ms"`): DateTime as INTEGER epoch-ms, Boolean
 * as 0/1, BigInt as INTEGER. Rows are read with bun:sqlite
 * `safeIntegers: true`, so every INTEGER arrives as a JS bigint.
 *
 * Every converter validates its input and throws with the column name — a
 * silently-wrong import is worse than a crashed one.
 */
import type { Prisma } from "#generated/prisma/client/index.js";

export type SqliteRow = Record<string, unknown>;

/**
 * The client shape shared by PrismaClient, its interactive transaction, and
 * the $extends-wrapped test client. `$transaction` is excluded because its
 * signature differs between base and extended clients; ImportClient in
 * run-import.ts adds the one call shape the importer needs.
 */
export type ImportTx = Omit<Prisma.TransactionClient, "$transaction">;

function fail(column: string, expected: string, value: unknown): never {
  throw new Error(
    `Column ${column}: expected ${expected}, got ${typeof value} (${String(value)})`,
  );
}

export function toInt(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value === "bigint" || typeof value === "number") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      fail(column, "safe integer", value);
    }
    return asNumber;
  }
  fail(column, "integer", value);
}

export function toIntOrNull(row: SqliteRow, column: string): number | null {
  return row[column] === null ? null : toInt(row, column);
}

export function toBigInt(row: SqliteRow, column: string): bigint {
  const value = row[column];
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  fail(column, "bigint", value);
}

export function toBigIntOrNull(row: SqliteRow, column: string): bigint | null {
  return row[column] === null ? null : toBigInt(row, column);
}

export function toStr(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value === "string") {
    return value;
  }
  fail(column, "string", value);
}

export function toStrOrNull(row: SqliteRow, column: string): string | null {
  return row[column] === null ? null : toStr(row, column);
}

export function toBool(row: SqliteRow, column: string): boolean {
  const value = row[column];
  if (typeof value === "bigint" || typeof value === "number") {
    if (Number(value) === 0) return false;
    if (Number(value) === 1) return true;
  }
  fail(column, "0/1 boolean", value);
}

export function toBoolOrNull(row: SqliteRow, column: string): boolean | null {
  return row[column] === null ? null : toBool(row, column);
}

export function toDate(row: SqliteRow, column: string): Date {
  const value = row[column];
  if (typeof value === "bigint" || typeof value === "number") {
    const ms = Number(value);
    if (!Number.isSafeInteger(ms)) {
      fail(column, "epoch-ms integer", value);
    }
    return new Date(ms);
  }
  // Belt and braces for TEXT-affinity stragglers from the brief iso8601
  // window that 20260514120000_revert_libsql_datetime_to_unixepoch reverted.
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      fail(column, "parseable date string", value);
    }
    return parsed;
  }
  fail(column, "epoch-ms integer or date string", value);
}

export function toDateOrNull(row: SqliteRow, column: string): Date | null {
  return row[column] === null ? null : toDate(row, column);
}

/**
 * Branded/enum fields (mirroring scripts/brand-prisma-types.ts): parse the
 * converted raw value through the data package's schema, with null
 * passthrough for nullable columns.
 */
export function parseOrNull<T>(
  schema: { parse: (value: unknown) => T },
  value: string | number | null,
): T | null {
  return value === null ? null : schema.parse(value);
}

/**
 * Normalize a transformed (or Postgres-fetched) row into a dialect-neutral
 * plain value for digest comparison: Date → epoch-ms, boolean → 0/1,
 * bigint → decimal string. Key order is fixed by sorting.
 */
export function normalizeForDigest(record: Record<string, unknown>): string {
  const entries = Object.entries(record)
    .map(([key, value]): [string, unknown] => {
      if (value instanceof Date) return [key, value.getTime()];
      if (typeof value === "boolean") return [key, value ? 1 : 0];
      if (typeof value === "bigint") return [key, value.toString()];
      return [key, value];
    })
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}

export const IMPORT_CHUNK_SIZE = 1000;

export function chunked<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Erased per-model operations the importer iterates in topological order. */
export type ImportModelSpec = {
  model: string;
  idColumns: string[];
  resetIdSequence: boolean;
  /** Transform + createMany in chunks; returns rows inserted. */
  insertRows: (tx: ImportTx, rows: SqliteRow[]) => Promise<number>;
  count: (tx: ImportTx) => Promise<number>;
  /** Transform only — digest material for the SQLite side. */
  digestSqliteRow: (row: SqliteRow) => string;
  /** All Postgres rows, PK-ordered, as digest material. */
  fetchPgDigestRows: (tx: ImportTx) => Promise<string[]>;
};

type ImportModelDefinition<T extends Record<string, unknown>> = {
  model: string;
  idColumns: string[];
  resetIdSequence: boolean;
  transform: (row: SqliteRow) => T;
  createMany: (tx: ImportTx, data: T[]) => Promise<number>;
  count: (tx: ImportTx) => Promise<number>;
  findAll: (tx: ImportTx) => Promise<Record<string, unknown>[]>;
};

export function defineImportModel<T extends Record<string, unknown>>(
  definition: ImportModelDefinition<T>,
): ImportModelSpec {
  return {
    model: definition.model,
    idColumns: definition.idColumns,
    resetIdSequence: definition.resetIdSequence,
    insertRows: async (tx, rows) => {
      let inserted = 0;
      const data = rows.map((row) => {
        try {
          return definition.transform(row);
        } catch (error) {
          throw new Error(
            `${definition.model}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      });
      for (const chunk of chunked(data, IMPORT_CHUNK_SIZE)) {
        inserted += await definition.createMany(tx, chunk);
      }
      return inserted;
    },
    count: definition.count,
    digestSqliteRow: (row) => normalizeForDigest(definition.transform(row)),
    fetchPgDigestRows: async (tx) => {
      const rows = await definition.findAll(tx);
      return rows.map((row) => normalizeForDigest(row));
    },
  };
}
