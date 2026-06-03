import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const committedTemplatePath = `${import.meta.dirname}/../src/testing/template.db`;
const generatorPath = `${import.meta.dirname}/generate-test-template-db.ts`;

type SqlValue = bigint | null | number | string | Uint8Array;
type JsonValue =
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type SqlRow = Record<string, SqlValue>;
type SchemaRow = {
  name: string;
  sql: string | null;
  tbl_name: string;
  type: string;
};
type TableNameRow = {
  name: string;
};
type TableColumnRow = {
  cid: number;
  dflt_value: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
};
type TableSnapshot = {
  columns: TableColumnRow[];
  name: string;
  rows: JsonValue[];
};
type DatabaseSnapshot = {
  schema: SchemaRow[];
  tables: TableSnapshot[];
};

function buildChildEnv(templatePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env["SCOUT_TEST_TEMPLATE_DB_PATH"] = templatePath;
  return env;
}

function getBunExecutable(): string {
  const executable = Bun.argv[0];
  if (executable === undefined) {
    throw new Error("Unable to locate Bun executable for template generation");
  }
  return executable;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value: SqlValue): JsonValue {
  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { type: "blob", value: Array.from(value) };
  }
  return value;
}

function normalizeSqlRow(row: SqlRow): JsonValue {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]),
  );
}

function readTableColumns(db: Database, tableName: string): TableColumnRow[] {
  return db
    .query<
      TableColumnRow,
      []
    >(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all();
}

function readTableRows(
  db: Database,
  tableName: string,
  columns: TableColumnRow[],
): JsonValue[] {
  if (columns.length === 0) {
    return [];
  }

  const columnList = columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ");
  const orderBy = columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ");

  return db
    .query<SqlRow, []>(
      `SELECT ${columnList} FROM ${quoteIdentifier(tableName)} ORDER BY ${orderBy}`,
    )
    .all()
    .map(normalizeSqlRow);
}

function readDatabaseSnapshot(path: string): DatabaseSnapshot {
  const db = new Database(path, { readonly: true });
  try {
    const schema = db
      .query<
        SchemaRow,
        []
      >(["SELECT type, name, tbl_name, sql", "FROM sqlite_schema", "WHERE name NOT LIKE 'sqlite_%'", "ORDER BY type, name, tbl_name"].join(" "))
      .all();

    const tableNames = db
      .query<
        TableNameRow,
        []
      >(["SELECT name", "FROM sqlite_schema", "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", "ORDER BY name"].join(" "))
      .all();

    return {
      schema,
      tables: tableNames.map((table) => {
        const columns = readTableColumns(db, table.name);
        return {
          columns,
          name: table.name,
          rows: readTableRows(db, table.name, columns),
        };
      }),
    };
  } finally {
    db.close();
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "scout-test-template-"));
const generatedTemplatePath = join(tempDir, "template.db");
let templateIsStale = false;

try {
  const result = Bun.spawnSync({
    cmd: [getBunExecutable(), "run", generatorPath],
    cwd: `${import.meta.dirname}/..`,
    env: buildChildEnv(generatedTemplatePath),
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate test template database for freshness check (exit ${result.exitCode})`,
    );
  }

  const committedSnapshot = readDatabaseSnapshot(committedTemplatePath);
  const generatedSnapshot = readDatabaseSnapshot(generatedTemplatePath);

  if (
    JSON.stringify(committedSnapshot, null, 2) !==
    JSON.stringify(generatedSnapshot, null, 2)
  ) {
    console.error(
      [
        "Scout test template database is stale.",
        "",
        "This can happen when:",
        "  - A Prisma migration was added or changed",
        "  - Season seed data (seasons.ts) was updated",
        "  - A dependency update changed generated SQLite contents",
        "",
        "Run this from packages/scout-for-lol/packages/backend:",
        "  bun run generate:test-template",
        "",
        `Committed: ${committedTemplatePath}`,
      ].join("\n"),
    );
    templateIsStale = true;
  } else {
    console.log("Scout test template database is up-to-date.");
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

if (templateIsStale) {
  process.exit(1);
}
