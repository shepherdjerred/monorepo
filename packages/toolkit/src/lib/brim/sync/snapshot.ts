import { Database } from "bun:sqlite";
import { z } from "zod";
import { readImmutableDatabase } from "#lib/history/sources-shared.ts";
import { redactBytes, type SecretMatch } from "./redact.ts";

/**
 * A redacted, point-in-time copy of the parts of a live SQLite database that
 * a history reader consumes.
 *
 * The live file is never copied raw: its `-wal` may hold committed pages the
 * main file lacks, and its free pages may still hold deleted text. Instead,
 * `sqlite3_serialize` reads every page through SQLite's pager inside one read
 * transaction (so WAL content is included and a concurrent writer cannot tear
 * it), into memory. Only the projected tables and columns are copied from
 * that image into a fresh in-memory database, every text and blob cell there
 * is redacted on its own (so no match spans two cells), and the result is
 * vacuumed and serialized. Nothing unredacted is written to disk, and FTS
 * indexes, bodies and other columns the reader ignores never leave the
 * machine.
 */

export type SqliteTableProjection = {
  readonly table: string;
  readonly columns: readonly string[];
  /** Rewrites a text cell of `column` before redaction; throws to refuse. */
  readonly rewrite?: Readonly<Record<string, (value: string) => string>>;
};

export type SqliteProjection = {
  /** Copied when present; a missing table is the reader's concern. */
  readonly tables: readonly SqliteTableProjection[];
};

export type SqliteSnapshot = {
  readonly bytes: Uint8Array;
  readonly matches: readonly SecretMatch[];
};

const OUTPUT = "snapshot";
const TableInfoSchema = z.object({ name: z.string(), type: z.string() });
const NameSchema = z.object({ name: z.string() });
const CellSchema = z.object({
  id: z.union([z.number(), z.bigint()]),
  value: z.union([z.string(), z.instanceof(Uint8Array)]),
});

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * A WAL-mode header (bytes 18 and 19 set to 2) makes an in-memory database
 * refuse to open; the image is rollback-journal data either way.
 */
function asRollbackImage(image: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(image);
  if (copy.length > 19) {
    copy[18] = 1;
    copy[19] = 1;
  }
  return copy;
}

async function serializeLive(file: string): Promise<Uint8Array> {
  const live = await readImmutableDatabase(file, "brim sync snapshot");
  try {
    return live.serialize();
  } finally {
    live.close();
  }
}

function copyTable(database: Database, projection: SqliteTableProjection) {
  const columns = new Map(
    database
      .query(`PRAGMA main.table_info(${quote(projection.table)})`)
      .all()
      .map((row: unknown) => TableInfoSchema.parse(row))
      .map((row) => [row.name, row.type] as const),
  );
  const definitions = projection.columns.map((column) => {
    const type = columns.get(column);
    if (type === undefined) {
      throw new Error(
        `table ${projection.table} has no column ${column} to snapshot`,
      );
    }
    return `${quote(column)} ${type}`;
  });
  const list = projection.columns.map((column) => quote(column)).join(", ");
  database.run(
    `CREATE TABLE ${OUTPUT}.${quote(projection.table)} (${definitions.join(", ")})`,
  );
  database.run(
    `INSERT INTO ${OUTPUT}.${quote(projection.table)} (${list}) SELECT ${list} FROM main.${quote(projection.table)}`,
  );
}

type Cell = z.infer<typeof CellSchema>;

/** The redacted value of one cell, or `null` when it is unchanged. */
function redactCell(
  cell: Cell,
  rewrite: ((value: string) => string) | undefined,
  matches: SecretMatch[],
): string | Uint8Array | null {
  if (typeof cell.value !== "string") {
    const redacted = redactBytes(cell.value);
    matches.push(...redacted.matches);
    return redacted.matches.length > 0 ? redacted.bytes : null;
  }
  const text = rewrite === undefined ? cell.value : rewrite(cell.value);
  const redacted = redactBytes(new TextEncoder().encode(text));
  matches.push(...redacted.matches);
  return text === cell.value && redacted.matches.length === 0
    ? null
    : new TextDecoder().decode(redacted.bytes);
}

function rewriteAndRedact(
  database: Database,
  projection: SqliteTableProjection,
  matches: SecretMatch[],
): void {
  const table = `${OUTPUT}.${quote(projection.table)}`;
  for (const column of projection.columns) {
    const rewrite = projection.rewrite?.[column];
    const update = database.prepare(
      `UPDATE ${table} SET ${quote(column)} = ? WHERE rowid = ?`,
    );
    const cells = database
      .query(
        `SELECT rowid AS id, ${quote(column)} AS value FROM ${table} WHERE typeof(${quote(column)}) IN ('text', 'blob')`,
      )
      .all()
      .map((row: unknown) => CellSchema.parse(row));
    for (const cell of cells) {
      const value = redactCell(cell, rewrite, matches);
      if (value !== null) update.run(value, cell.id);
    }
  }
}

export async function sqliteSnapshot(
  file: string,
  projection: SqliteProjection,
): Promise<SqliteSnapshot> {
  const image = asRollbackImage(await serializeLive(file));
  const database = Database.deserialize(image, {
    strict: true,
    safeIntegers: true,
  });
  try {
    database.run(`ATTACH DATABASE ':memory:' AS ${OUTPUT}`);
    // Overwrite, rather than free, the bytes of every cell rewritten below.
    database.run(`PRAGMA ${OUTPUT}.secure_delete = ON`);
    const present = new Set(
      database
        .query("SELECT name FROM main.sqlite_master WHERE type = 'table'")
        .all()
        .map((row: unknown) => NameSchema.parse(row).name),
    );
    const matches: SecretMatch[] = [];
    for (const table of projection.tables) {
      if (!present.has(table.table)) continue;
      copyTable(database, table);
      rewriteAndRedact(database, table, matches);
    }
    database.run(`VACUUM ${OUTPUT}`);
    return { bytes: Uint8Array.from(database.serialize(OUTPUT)), matches };
  } finally {
    database.close();
  }
}
