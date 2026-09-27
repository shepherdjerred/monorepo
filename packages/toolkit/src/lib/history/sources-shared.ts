import { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { HistoryPaths } from "./paths.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryScanOptions,
  HistorySource,
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

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function batches<T>(values: readonly T[], size = 8): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
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

async function statPart(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${file}:${String(info.mtimeMs)}:${String(info.size)}`;
  } catch {
    return `${file}:missing`;
  }
}

export type FileStats = {
  readonly fingerprint: string;
  readonly signatures: ReadonlyMap<string, string>;
};

async function fingerprintParts(files: readonly string[]): Promise<{
  readonly ordered: readonly string[];
  readonly byFile: ReadonlyMap<string, string>;
}> {
  const flat = files
    .flatMap((file) => [file, `${file}-wal`, `${file}-shm`])
    .sort();
  const parts = new Map<string, string>();
  const ordered: string[] = [];
  for (const file of flat) {
    const part = await statPart(file);
    parts.set(file, part);
    ordered.push(part);
  }
  return { ordered, byFile: parts };
}

/**
 * Stats every file (plus SQLite `-wal`/`-shm` companions) once, returning
 * both the whole-source fingerprint and a per-file signature for
 * change detection. The fingerprint keeps its exact historical shape so
 * stored source-state rows still compare.
 */
export async function statFiles(files: readonly string[]): Promise<FileStats> {
  const { ordered, byFile } = await fingerprintParts(files);
  const signatures = new Map<string, string>();
  for (const file of files) {
    const own = byFile.get(file);
    const wal = byFile.get(`${file}-wal`);
    const shm = byFile.get(`${file}-shm`);
    if (own === undefined || wal === undefined || shm === undefined) {
      throw new Error(`Missing fingerprint part for ${file}`);
    }
    signatures.set(file, [own, wal, shm].join("|"));
  }
  return { fingerprint: ordered.join("|"), signatures };
}

export type FileDiff = {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
};

export function diffFiles(
  previous: ReadonlyMap<string, string> | null,
  current: ReadonlyMap<string, string>,
): FileDiff {
  if (previous === null) {
    return { added: [...current.keys()], changed: [], deleted: [] };
  }
  const added: string[] = [];
  const changed: string[] = [];
  for (const [file, signature] of current) {
    const prior = previous.get(file);
    if (prior === undefined) {
      added.push(file);
    } else if (prior !== signature) {
      changed.push(file);
    }
  }
  const deleted: string[] = [];
  for (const file of previous.keys()) {
    if (!current.has(file)) {
      deleted.push(file);
    }
  }
  return { added, changed, deleted };
}

/**
 * The fingerprint is captured BEFORE parsing on purpose: what ingest
 * compares is the file state this scan read from, so a file written
 * mid-scan always differs on the next pass and its new content is
 * ingested then. A post-parse fingerprint would already contain that
 * write and ingest would skip the re-read forever.
 */
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
      complete: true,
      sourceIds: [],
    };
  }
  const { fingerprint } = await statFiles(files);
  try {
    const documents = await read();
    return {
      source,
      available: true,
      documents,
      fingerprint,
      error: null,
      complete: true,
      sourceIds: documents.map((document) => document.sourceId),
    };
  } catch (error: unknown) {
    return {
      source,
      available: false,
      documents: [],
      fingerprint,
      error: error instanceof Error ? error.message : String(error),
      complete: true,
      sourceIds: [],
    };
  }
}

/** A scan that parsed only some files; `sourceIds` is still the full set. */
export function incrementalResult(
  source: HistorySourceName,
  documents: readonly HistoryDocument[],
  sourceIds: readonly string[],
  fingerprint: string,
): HistorySourceResult {
  return {
    source,
    available: true,
    documents,
    fingerprint,
    error: null,
    complete: false,
    sourceIds: [...sourceIds].sort(),
  };
}

/** A scan that parsed every file. */
export function fullScanResult(
  source: HistorySourceName,
  documents: readonly HistoryDocument[],
  sourceIds: readonly string[],
  fingerprint: string,
): HistorySourceResult {
  return {
    source,
    available: true,
    documents,
    fingerprint,
    error: null,
    complete: true,
    sourceIds: [...sourceIds],
  };
}

/** A scan that failed before producing documents; advances nothing. */
export function failedScanResult(
  source: HistorySourceName,
  fingerprint: string,
  error: unknown,
): HistorySourceResult {
  return {
    source,
    available: false,
    documents: [],
    fingerprint,
    error: error instanceof Error ? error.message : String(error),
    complete: true,
    sourceIds: [],
  };
}

export type FileScanPlan = {
  readonly fingerprint: string;
  readonly signatures: ReadonlyMap<string, string>;
  readonly full: boolean;
  readonly parseFiles: readonly string[];
};

/**
 * Decides which files a scan must parse: everything on the first scan,
 * after `force`, or when any file vanished (retiring one document while
 * trusting cached stats for the rest would strand a ghost id if a file
 * ever reappeared with identical mtime+size, and deletions are rare);
 * otherwise only added and changed files. The returned signatures are
 * pre-parse, so a file written mid-scan differs on the next pass and its
 * new content is parsed then.
 */
export async function planFileScan(
  files: readonly string[],
  previous: ReadonlyMap<string, string> | null,
  force: boolean,
): Promise<FileScanPlan> {
  const { fingerprint, signatures } = await statFiles(files);
  const diff =
    force || previous === null ? null : diffFiles(previous, signatures);
  const full = diff === null || diff.deleted.length > 0;
  return {
    fingerprint,
    signatures,
    full,
    parseFiles: full ? [...files] : [...diff.added, ...diff.changed].sort(),
  };
}

export type StagedScan<TState> = {
  readonly result: HistorySourceResult;
  readonly staged: TState | null;
};

/**
 * Two-phase incremental scanning: `scan` stages the next cache state for
 * its files, and `commitScan` advances to it — called only after the
 * results were ingested. Every scan overwrites the staged slot, including
 * a failed scan staging nothing, so a later commit can never advance to a
 * previous scan's state for documents that were never indexed; the slot is
 * cleared after each commit for the same reason. The next scan after a
 * failure therefore retries from the last committed state.
 */
export function createStagedScanner<TState>(
  scan: (
    paths: HistoryPaths,
    committed: TState | null,
    force: boolean,
  ) => Promise<StagedScan<TState>>,
): Pick<HistorySource, "scan" | "commitScan"> {
  let committed: TState | null = null;
  let staged: TState | null = null;
  return {
    scan: async (paths: HistoryPaths, options?: HistoryScanOptions) => {
      const { result, staged: next } = await scan(
        paths,
        committed,
        options?.force ?? false,
      );
      staged = next;
      return result;
    },
    commitScan: () => {
      if (staged !== null) {
        committed = staged;
        staged = null;
      }
    },
  };
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

/**
 * Opens a SQLite file readonly, falling back to an immutable `file:` URL
 * connection when the ordinary readonly open fails with SQLITE_CANTOPEN — a
 * WAL-mode database whose `-shm` companion hasn't been established yet by a
 * read-write-capable connection can throw exactly that error on a pure
 * readonly open. Refuses the immutable fallback outright if the `-wal` file
 * is nonzero, since that means a live process has uncommitted writes and an
 * immutable snapshot would be reading a stale/inconsistent main file.
 */
export async function readImmutableDatabase(
  filePath: string,
  label: string,
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
          `${label} database cannot be opened read-only while its live WAL is present: ${filePath}-wal`,
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

export function readCursorDatabase(
  filePath: string,
  openOrdinary: DatabaseOpener = readDatabase,
): Promise<Database> {
  return readImmutableDatabase(filePath, "Cursor", openOrdinary);
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
