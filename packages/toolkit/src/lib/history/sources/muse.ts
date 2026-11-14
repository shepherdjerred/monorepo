import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
} from "#lib/history/query/messages.ts";
import type { HistoryPaths } from "#lib/history/paths.ts";
import {
  createStagedScanner,
  diffFiles,
  failedScanResult,
  firstText,
  fullScanResult,
  incrementalResult,
  pathExists,
  readImmutableDatabase,
  requireTables,
  rows,
  sourceReadResult,
  sourceResult,
  statFiles,
  type StagedScan,
} from "#lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
} from "#lib/history/types.ts";
import { modifiedAt } from "./jsonl.ts";
import { MICROSECONDS_PER_MS, readMuseTranscript } from "./muse-transcript.ts";

/**
 * Meta Muse (`~/.local/share/muse`). `session-index.db` lists the root
 * sessions with their title, workspace, and branch; each row's
 * `session_log_path` is an append-only `session.jsonl` event log. Subagents
 * (spawned workers and memory-reminder children) write their own logs under
 * `<session_dir>/subagent/<uuid>/session.jsonl` and are not index rows; each
 * is indexed as its own document whose title names its parent session.
 *
 * Every timestamp Muse writes (`recorded_at`, `created_at_us`) is epoch
 * microseconds.
 */

const SOURCE = "Muse";
const INDEX_DB = "session-index.db";
const LOG_FILE = "session.jsonl";
const SUBAGENT_DIR = "subagent";

const MuseSessionRowSchema = z.object({
  session_id: z.string().min(1),
  session_dir: z.string().min(1),
  session_log_path: z.string().min(1),
  layout: z.string(),
  workspace_root: z.string().nullable(),
  git_branch: z.string().nullable(),
  msp_branch: z.string().nullable(),
  title: z.string(),
  created_at_us: z.number().int().positive().nullable(),
  updated_at_us: z.number().int().positive().nullable(),
});

type MuseSessionRow = z.infer<typeof MuseSessionRowSchema>;

/** One log to index, with the metadata its document takes from the index. */
type MuseLog = {
  readonly file: string;
  readonly sessionId: string;
  /** The root index row: its own for a root session, its parent's otherwise. */
  readonly row: MuseSessionRow;
  readonly subagent: boolean;
};

function microsecondsToIso(value: number | null): string | null {
  return value === null
    ? null
    : new Date(Math.floor(value / MICROSECONDS_PER_MS)).toISOString();
}

async function museSessionRows(dbPath: string): Promise<MuseSessionRow[]> {
  const database = await readImmutableDatabase(dbPath, SOURCE);
  try {
    requireTables(database, SOURCE, ["sessions"]);
    return rows(
      database,
      `SELECT session_id, session_dir, session_log_path, layout,
              workspace_root, git_branch, msp_branch, title,
              created_at_us, updated_at_us
         FROM sessions
        ORDER BY created_at_us, session_id`,
      MuseSessionRowSchema,
    );
  } finally {
    database.close();
  }
}

async function subagentLogs(sessionDir: string): Promise<string[]> {
  const directory = path.join(sessionDir, SUBAGENT_DIR);
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const logs: string[] = [];
  for (const entry of entries) {
    const log = path.join(directory, entry.name, LOG_FILE);
    if (entry.isDirectory() && (await pathExists(log))) {
      logs.push(log);
    }
  }
  return logs.sort();
}

/**
 * Every root session's log must exist: an index row whose log is gone is a
 * broken contract, not an empty session. Subagent directories without a log
 * yet (a child that has not started) are skipped.
 */
async function museLogs(
  rowsList: readonly MuseSessionRow[],
): Promise<MuseLog[]> {
  const logs: MuseLog[] = [];
  const seen = new Set<string>();
  for (const row of rowsList) {
    if (row.layout !== "session_jsonl") {
      throw new Error(
        `Muse session ${row.session_id} has an unsupported layout: ${row.layout}`,
      );
    }
    if (!(await pathExists(row.session_log_path))) {
      throw new Error(`Muse session log is missing: ${row.session_log_path}`);
    }
    if (!seen.has(row.session_log_path)) {
      seen.add(row.session_log_path);
      logs.push({
        file: row.session_log_path,
        sessionId: row.session_id,
        row,
        subagent: false,
      });
    }
    for (const file of await subagentLogs(row.session_dir)) {
      if (!seen.has(file)) {
        seen.add(file);
        logs.push({
          file,
          sessionId: path.basename(path.dirname(file)),
          row,
          subagent: true,
        });
      }
    }
  }
  return logs;
}

async function museDocument(
  log: MuseLog,
  museRoot: string,
): Promise<HistoryDocument> {
  const transcript = await readMuseTranscript(
    log.file,
    INDEXED_MESSAGE_PARSE_LIMIT,
  );
  const fallback = await modifiedAt(log.file);
  const rowBranch = log.row.git_branch ?? log.row.msp_branch;
  const parentTitle = firstText(log.row.title, "Muse session");
  const title = log.subagent
    ? firstText(
        `[subagent of ${parentTitle}] ${openingPrompt(transcript.messages) ?? log.sessionId}`,
        parentTitle,
      )
    : parentTitle;
  return makeHistoryDocument(
    {
      source: "muse",
      sourceId: path.relative(museRoot, log.file),
      title,
      path: log.file,
      // A subagent reports its own workspace when it has one; a
      // memory-reminder child runs in its parent's.
      workspace: log.subagent
        ? (transcript.workspace ?? log.row.workspace_root)
        : (log.row.workspace_root ?? transcript.workspace),
      gitBranch: log.subagent
        ? transcript.sawBranch
          ? transcript.gitBranch
          : rowBranch
        : (rowBranch ?? transcript.gitBranch),
      agent: "Meta Muse",
      createdAt:
        (log.subagent ? null : microsecondsToIso(log.row.created_at_us)) ??
        transcript.firstAt ??
        fallback,
      updatedAt:
        (log.subagent ? null : microsecondsToIso(log.row.updated_at_us)) ??
        transcript.lastAt ??
        fallback,
      runtimeId: log.sessionId,
      usageEvents: transcript.usageEvents,
    },
    transcript.messages,
  );
}

/**
 * A log's change signature is its file stat plus the index metadata its
 * document uses, so a retitle in the index re-parses that session (and its
 * subagents, whose titles name it) without re-reading unchanged logs. The
 * index database's own stat is deliberately not part of it: its WAL and
 * shared-memory files change on every Muse write and read.
 */
function rowSignature(row: MuseSessionRow): string {
  return JSON.stringify([
    row.title,
    row.workspace_root,
    row.git_branch,
    row.msp_branch,
    row.created_at_us,
    row.updated_at_us,
  ]);
}

async function scanMuse(
  paths: HistoryPaths,
  previous: ReadonlyMap<string, string> | null,
  force: boolean,
): Promise<StagedScan<ReadonlyMap<string, string>>> {
  const dbPath = path.join(paths.museRoot, INDEX_DB);
  if (!(await pathExists(dbPath))) {
    return {
      result: await sourceResult("muse", [], () => []),
      staged: new Map(),
    };
  }
  let logs: MuseLog[];
  try {
    logs = await museLogs(await museSessionRows(dbPath));
  } catch (error: unknown) {
    return {
      result: failedScanResult("muse", "unreadable", error),
      staged: null,
    };
  }
  const stats = await statFiles(logs.map((log) => log.file));
  const signatures = new Map(
    logs.map((log) => [
      log.file,
      `${stats.signatures.get(log.file) ?? "missing"}|${rowSignature(log.row)}`,
    ]),
  );
  const fingerprint = [...signatures.values()].join("|");
  const diff =
    force || previous === null ? null : diffFiles(previous, signatures);
  const full = diff === null || diff.deleted.length > 0;
  const changed = new Set(full ? [] : [...diff.added, ...diff.changed]);
  try {
    const documents: HistoryDocument[] = [];
    for (const log of logs) {
      if (full || changed.has(log.file)) {
        documents.push(await museDocument(log, paths.museRoot));
      }
    }
    const sourceIds = logs.map((log) =>
      path.relative(paths.museRoot, log.file),
    );
    return {
      result: full
        ? fullScanResult("muse", documents, sourceIds, fingerprint)
        : incrementalResult("muse", documents, sourceIds, fingerprint),
      staged: signatures,
    };
  } catch (error: unknown) {
    return {
      result: failedScanResult("muse", fingerprint, error),
      staged: null,
    };
  }
}

export function createMuseSource(): HistorySource {
  return {
    name: "muse",
    label: "Meta Muse",
    ...createStagedScanner(scanMuse),
    async read(_paths: HistoryPaths, records: readonly HistoryRecord[]) {
      return sourceReadResult(
        "muse",
        records.map((record) => record.sourceId),
        async () => {
          const messages = new Map<string, readonly HistoryMessage[]>();
          for (const record of records) {
            const transcript = await readMuseTranscript(record.path);
            messages.set(record.sourceId, transcript.messages);
          }
          return messages;
        },
      );
    },
  };
}
