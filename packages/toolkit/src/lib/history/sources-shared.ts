import { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type {
  HistoryDocument,
  HistoryMessage,
  HistorySourceName,
  HistorySourceReadResult,
  HistorySourceResult,
} from "./types.ts";

export const RowSchema = z.record(z.string(), z.unknown());

export function rows<T extends z.ZodType>(
  database: Database,
  sql: string,
  schema: T,
  values: readonly (string | number)[] = [],
): z.infer<T>[] {
  return database
    .prepare(sql)
    .all(...values)
    .map((row: unknown) => schema.parse(row));
}

export function rowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

export function firstText(value: string, fallback: string): string {
  const text = value.replaceAll(/\s+/gu, " ").trim();
  return text.length > 0 ? text.slice(0, 120) : fallback;
}

export function requireTables(
  database: Database,
  source: string,
  expected: string[],
): void {
  const available = new Set(
    rows(
      database,
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
      z.object({ name: z.string() }),
    ).map((row) => row.name),
  );
  const missing = expected.filter((table) => !available.has(table));
  if (missing.length > 0) {
    throw new Error(`${source} schema is missing: ${missing.join(", ")}`);
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function filesUnder(
  directory: string,
  extension?: string,
): Promise<string[]> {
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(entryPath, extension)));
    } else if (extension === undefined || entry.name.endsWith(extension)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

async function fingerprint(files: string[]): Promise<string> {
  const parts: string[] = [];
  const fingerprintFiles = files.flatMap((file) => [
    file,
    `${file}-wal`,
    `${file}-shm`,
  ]);
  for (const file of fingerprintFiles.sort()) {
    try {
      const info = await stat(file);
      parts.push(`${file}:${String(info.mtimeMs)}:${String(info.size)}`);
    } catch {
      parts.push(`${file}:missing`);
    }
  }
  return parts.join("|");
}

export async function sourceResult(
  source: HistorySourceName,
  files: string[],
  read: () => readonly HistoryDocument[] | Promise<readonly HistoryDocument[]>,
): Promise<HistorySourceResult> {
  if (files.length === 0) {
    return {
      source,
      available: false,
      documents: [],
      fingerprint: "missing",
      error: null,
    };
  }
  try {
    return {
      source,
      available: true,
      documents: await read(),
      fingerprint: await fingerprint(files),
      error: null,
    };
  } catch (error: unknown) {
    return {
      source,
      available: false,
      documents: [],
      fingerprint: await fingerprint(files),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readDatabase(filePath: string): Database {
  return new Database(filePath, { readonly: true, strict: true });
}

type DatabaseOpener = (filePath: string) => Database;

function isCantOpen(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SQLITE_CANTOPEN") ||
    message.toLocaleLowerCase().includes("unable to open database file")
  );
}

export async function readCursorDatabase(
  filePath: string,
  openOrdinary: DatabaseOpener = readDatabase,
): Promise<Database> {
  let ordinary: Database | null = null;
  try {
    ordinary = openOrdinary(filePath);
    ordinary.query("SELECT 1").get();
    return ordinary;
  } catch (error: unknown) {
    ordinary?.close();
    if (!isCantOpen(error)) {
      throw error;
    }
    try {
      const wal = await stat(`${filePath}-wal`);
      if (wal.size > 0) {
        throw new Error(
          `Cursor database cannot be opened read-only while its live WAL is present: ${filePath}-wal`,
          { cause: error },
        );
      }
    } catch (walError: unknown) {
      const code = z
        .object({ code: z.string().optional() })
        .safeParse(walError);
      if (!code.success || code.data.code !== "ENOENT") {
        throw walError;
      }
    }
    const immutableUrl = pathToFileURL(filePath);
    immutableUrl.searchParams.set("immutable", "1");
    return new Database(immutableUrl.href, { readonly: true, strict: true });
  }
}

export async function sourceReadResult(
  source: HistorySourceName,
  requestedSourceIds: readonly string[],
  read: () =>
    | ReadonlyMap<string, readonly HistoryMessage[]>
    | Promise<ReadonlyMap<string, readonly HistoryMessage[]>>,
): Promise<HistorySourceReadResult> {
  try {
    const messages = await read();
    return {
      source,
      messages,
      missingSourceIds: requestedSourceIds.filter(
        (sourceId) => !messages.has(sourceId),
      ),
      error: null,
    };
  } catch (error: unknown) {
    return {
      source,
      messages: new Map(),
      missingSourceIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
