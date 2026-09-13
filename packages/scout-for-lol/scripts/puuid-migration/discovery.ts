/**
 * Runtime discovery of every column holding a PUUID.
 *
 * Prod and beta have different schemas today, and prod's will change again
 * when it is promoted, so a hardcoded column list would be wrong for at least
 * one target at all times. Discovery reads the live catalog instead, then
 * audits everything it did NOT register — a PUUID sitting in an unregistered
 * column would be silently stranded, so the audit fails the run rather than
 * migrating a partial database.
 */

import type { Db } from "./db.ts";
import { collectFromJson, parseJson, selectSubtree } from "./json-walk.ts";
import {
  asOptionalString,
  EXCLUDED_TABLES,
  EXTRA_JSON_COLUMNS,
  TRACKED_SOURCES,
} from "./support.ts";

export type ColumnKind = "scalar" | "json";

export type PuuidColumn = {
  table: string;
  column: string;
  kind: ColumnKind;
  /** True for `*Puuids` columns, whose arrays hold bare PUUID strings. */
  bareArrayIsPuuids: boolean;
};

function isExtraColumn(table: string, column: string): boolean {
  return EXTRA_JSON_COLUMNS.some(
    (e) => e.table === table && e.column === column,
  );
}

async function sampleValue(
  db: Db,
  table: string,
  column: string,
): Promise<string | null> {
  const rows = await db.query(
    `SELECT "${column}" AS v FROM "${table}" WHERE "${column}" IS NOT NULL LIMIT 1`,
  );
  return asOptionalString(rows[0]?.["v"]);
}

/**
 * Classify by sampling a real value rather than by name, since `trackedPuuids`
 * and `puuid` look alike but are not. An empty table cannot be sampled, hence
 * the name fallback.
 */
export function classify(column: string, sample: string | null): ColumnKind {
  if (sample === null) {
    return /puuids$/i.test(column) ? "json" : "scalar";
  }
  const head = sample.trimStart();
  return head.startsWith("[") || head.startsWith("{") ? "json" : "scalar";
}

export async function discoverColumns(db: Db): Promise<PuuidColumn[]> {
  const tables = await db.listTables();
  const discovered: PuuidColumn[] = [];

  for (const table of tables) {
    if (EXCLUDED_TABLES.has(table)) {
      continue;
    }
    const columns = await db.listTextColumns(table);
    for (const column of columns) {
      const extra = isExtraColumn(table, column);
      if (!extra && !column.toLowerCase().includes("puuid")) {
        continue;
      }
      const sample = await sampleValue(db, table, column);
      discovered.push({
        table,
        column,
        kind: extra ? "json" : classify(column, sample),
        bareArrayIsPuuids: /puuids$/i.test(column),
      });
    }
  }

  return discovered;
}

/**
 * PUUIDs are 78-character base64url strings. Extracting every token of that
 * shape and testing set membership makes the audit exhaustive in one pass per
 * column, instead of N substring queries per column against a sampled subset —
 * which was both slower and silently incomplete, reporting a different set of
 * offenders depending on which PUUIDs happened to be sampled.
 */
export const PUUID_TOKEN_PATTERN = /[\w-]{70,90}/g;

async function columnHoldsAny(
  db: Db,
  table: string,
  column: string,
  known: ReadonlySet<string>,
): Promise<boolean> {
  const rows = await db.query(
    `SELECT "${column}" AS v FROM "${table}" WHERE "${column}" IS NOT NULL`,
  );
  for (const row of rows) {
    const value = asOptionalString(row["v"]);
    if (value === null) {
      continue;
    }
    for (const token of value.matchAll(PUUID_TOKEN_PATTERN)) {
      if (known.has(token[0])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Anything holding a PUUID that discovery did not register is a surface we
 * would silently strand. Report it and stop.
 */
export async function auditForUnregistered(
  db: Db,
  registered: readonly PuuidColumn[],
  known: ReadonlySet<string>,
): Promise<void> {
  if (known.size === 0) {
    return;
  }
  const registeredKeys = new Set(
    registered.map((c) => `${c.table}.${c.column}`),
  );
  const offenders: string[] = [];

  for (const table of await db.listTables()) {
    if (EXCLUDED_TABLES.has(table)) {
      continue;
    }
    for (const column of await db.listTextColumns(table)) {
      if (registeredKeys.has(`${table}.${column}`)) {
        continue;
      }
      if (await columnHoldsAny(db, table, column, known)) {
        offenders.push(`${table}.${column}`);
      }
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `Unregistered PUUID-bearing columns found; add them to EXTRA_JSON_COLUMNS after inspecting:\n${offenders
        .map((o) => `  ${o}`)
        .join("\n")}`,
    );
  }
}

/** Every PUUID stored in one column, walking JSON structurally. */
export async function readPuuids(
  db: Db,
  col: PuuidColumn,
  where?: string,
  jsonPath?: string,
): Promise<string[]> {
  const rows = await db.query(
    `SELECT "${col.column}" AS v FROM "${col.table}" WHERE "${col.column}" IS NOT NULL${where === undefined ? "" : ` AND ${where}`}`,
  );
  const out: string[] = [];
  for (const row of rows) {
    const value = asOptionalString(row["v"]);
    if (value === null) {
      continue;
    }
    if (col.kind === "scalar") {
      out.push(value);
      continue;
    }
    const parsed = parseJson(value);
    const scope =
      jsonPath === undefined ? parsed : selectSubtree(parsed, jsonPath);
    if (scope === undefined) {
      continue;
    }
    collectFromJson(scope, col.bareArrayIsPuuids, out);
  }
  return out;
}

/**
 * Check every declared source against the live catalog before anything reads
 * one.
 *
 * `TRACKED_SOURCES` is hand-maintained, and SQLite will not tell you when it is
 * wrong: an unresolvable double-quoted identifier is accepted as a string
 * LITERAL rather than rejected as a column. So `WHERE "capturedAt" IS NOT NULL`
 * against a table without that column matches every row and hands back the text
 * `capturedAt` as the timestamp. Nothing errors at the SQL layer; the failure
 * surfaces much later as an identity that cannot be dated, or not at all.
 *
 * Absent tables are fine and expected — prod and beta have different schemas,
 * and prod's will change again at promotion. A table that IS present with a
 * column that is not is schema drift, and every use of it from here is wrong.
 */
export async function assertTrackedSourcesMatchSchema(db: Db): Promise<void> {
  const tables = new Set(await db.listTables());
  const drift: string[] = [];

  for (const source of TRACKED_SOURCES) {
    if (!tables.has(source.table)) {
      continue;
    }
    const columns = new Set(await db.listColumns(source.table));
    for (const column of [source.column, source.createdColumn]) {
      if (!columns.has(column)) {
        drift.push(`${source.table}.${column}`);
      }
    }
  }

  if (drift.length > 0) {
    throw new Error(
      `TRACKED_SOURCES names columns this database does not have:\n${[
        ...new Set(drift),
      ]
        .map((d) => `  ${d}`)
        .join(
          "\n",
        )}\nFix the declaration in support.ts against the live schema.`,
    );
  }
}

/**
 * The tracked identities — the only ones we re-domain. Sources absent from
 * this database are skipped, since prod and beta have different schemas; a
 * source that is present has already been checked against the catalog, so a
 * missing column here would be a bug rather than a schema difference.
 */
export async function readTrackedPuuids(db: Db): Promise<Set<string>> {
  const tables = new Set(await db.listTables());
  const tracked = new Set<string>();

  for (const source of TRACKED_SOURCES) {
    if (!tables.has(source.table)) {
      continue;
    }
    const values = await readPuuids(
      db,
      {
        table: source.table,
        column: source.column,
        kind: source.json ? "json" : "scalar",
        bareArrayIsPuuids: source.bareArray,
      },
      source.where,
      source.jsonPath,
    );
    for (const v of values) {
      tracked.add(v);
    }
    console.log(
      `  tracked from ${source.table}.${source.column}: ${values.length.toString()} values`,
    );
  }

  return tracked;
}
