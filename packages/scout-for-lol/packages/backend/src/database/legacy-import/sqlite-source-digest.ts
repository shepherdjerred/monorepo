import { Database } from "bun:sqlite";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sqliteDigestValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value instanceof Uint8Array ? [...value] : value;
}

function sqliteDigestRow(row: unknown): string {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Unexpected SQLite snapshot row shape");
  }
  return JSON.stringify(
    Object.entries(row)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => [key, sqliteDigestValue(value)]),
  );
}

function sqliteTableColumnNames(db: Database, table: string): string[] {
  const columns: unknown = db
    .query(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all();
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TypeError(`SQLite table ${table} has no columns`);
  }
  return columns.map((column) => {
    if (
      column === null ||
      typeof column !== "object" ||
      Array.isArray(column)
    ) {
      throw new TypeError(`Unexpected SQLite column shape for ${table}`);
    }
    const name: unknown = Reflect.get(column, "name");
    if (typeof name !== "string") {
      throw new TypeError(`SQLite column has invalid name for ${table}`);
    }
    return name;
  });
}

type DigestRows = (
  db: Database,
  table: string,
  update: (row: string) => void,
) => void;

function digestLegacySqlite(
  sqlitePath: string,
  digestRows: DigestRows,
): string {
  const db = new Database(sqlitePath, { readonly: true, safeIntegers: true });
  const hasher = new Bun.CryptoHasher("sha256");
  try {
    const schemaRows: unknown = db
      .query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();
    if (!Array.isArray(schemaRows)) {
      throw new TypeError("Unexpected SQLite schema result shape");
    }
    for (const schemaRow of schemaRows) {
      if (
        schemaRow === null ||
        typeof schemaRow !== "object" ||
        Array.isArray(schemaRow)
      ) {
        throw new TypeError("Unexpected SQLite schema row shape");
      }
      const name: unknown = Reflect.get(schemaRow, "name");
      const sql: unknown = Reflect.get(schemaRow, "sql");
      if (typeof name !== "string" || typeof sql !== "string") {
        throw new TypeError("SQLite schema row has invalid name or SQL");
      }
      hasher.update(`${name}\u{0}${sql}\u{0}`);
      digestRows(db, name, (row) => hasher.update(`${row}\u{0}`));
    }
    return hasher.digest("hex");
  } finally {
    db.close();
  }
}

/**
 * The import marker's established digest. Keep its ordering stable so an
 * unchanged retained database never looks changed after a backend upgrade.
 */
export function legacySqliteSourceDigest(sqlitePath: string): string {
  return digestLegacySqlite(sqlitePath, (db, table, update) => {
    const rows: unknown = db
      .query(`SELECT * FROM ${quoteIdentifier(table)}`)
      .all();
    if (!Array.isArray(rows)) {
      throw new TypeError(`Unexpected SQLite rows for ${table}`);
    }
    for (const row of rows.map((value) => sqliteDigestRow(value)).sort()) {
      update(row);
    }
  });
}

/**
 * Read-only retirement digest that streams every table instead of
 * materializing it. It is intentionally distinct from the import-marker
 * digest, whose historical byte ordering must remain unchanged.
 */
export function legacySqlitePreflightDigest(sqlitePath: string): string {
  return digestLegacySqlite(sqlitePath, (db, table, update) => {
    const orderBy = sqliteTableColumnNames(db, table)
      .map((column) => quoteIdentifier(column))
      .join(", ");
    const rows = db
      .query(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}`)
      .iterate();
    for (const row of rows) {
      update(sqliteDigestRow(row));
    }
  });
}
