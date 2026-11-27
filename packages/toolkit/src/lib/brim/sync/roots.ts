import path from "node:path";
import { defaultHistoryPaths } from "#lib/history/paths.ts";
import type { FileSelection, SyncRoot } from "./scan.ts";
import type { SqliteProjection } from "./snapshot.ts";

/**
 * Where each agent keeps its sessions, and which of its files `brim sync`
 * archives. The Grok, Kimi, Muse and Antigravity roots come from
 * `defaultHistoryPaths`, and each selector picks only the
 * files that store's history reader opens, so a mirror holds exactly what
 * `toolkit history` needs to index the remote sessions.
 *
 * Archive layout, under `<mirror>/<machine>/<tool>/`:
 * - grok: `sessions/**` (the mirrored Grok home is the tool directory);
 * - kimi: `sessions/**` (the mirrored Kimi sessions directory);
 * - muse: `session-index.db` and `sessions/**` (the tool directory is the
 *   mirrored Muse root);
 * - antigravity: `<slug>/conversations/*.db`, `<slug>/brain/**`,
 *   `<slug>/conversation_summaries.db`, one slug per Antigravity root.
 */

const JSONL = { kind: "jsonl" } as const;
const JSON_FILE = { kind: "json" } as const;

function sqlite(projection: SqliteProjection): FileSelection["format"] {
  return { kind: "sqlite", projection };
}

/** `sessions/<project>/<session>/{updates.jsonl,summary.json}`. */
function selectGrok(relative: string): FileSelection | null {
  const name = path.posix.basename(relative);
  const group = path.posix.dirname(relative);
  if (name === "updates.jsonl") return { format: JSONL, group };
  return name === "summary.json"
    ? { format: JSON_FILE, group, sidecar: true }
    : null;
}

const KIMI_WIRE = /^(?<session>[^/]+\/[^/]+)\/agents\/[^/]+\/wire\.jsonl$/u;
const KIMI_STATE = /^(?<session>[^/]+\/[^/]+)\/state\.json$/u;

/** `<workdir>/<session>/state.json` and `.../agents/<agent>/wire.jsonl`. */
function selectKimi(relative: string): FileSelection | null {
  const wire = KIMI_WIRE.exec(relative)?.groups?.["session"];
  if (wire !== undefined) return { format: JSONL, group: wire };
  const state = KIMI_STATE.exec(relative)?.groups?.["session"];
  return state === undefined
    ? null
    : { format: JSON_FILE, group: state, sidecar: true };
}

/**
 * Every `session.jsonl` under `sessions/`. A subagent's log under
 * `<session>/subagent/<id>/` is grouped with its root session, which the
 * reader needs to find it.
 */
function selectMuseLog(relative: string): FileSelection | null {
  if (path.posix.basename(relative) !== "session.jsonl") return null;
  const subagent = relative.indexOf("/subagent/");
  return {
    format: JSONL,
    group:
      subagent === -1
        ? path.posix.dirname(relative)
        : relative.slice(0, subagent),
  };
}

/**
 * The Muse index keeps absolute paths to each session's directory and log.
 * The snapshot stores them relative to the Muse root, which the reader
 * resolves against whichever root it scans; a path outside the root names a
 * log `brim sync` does not archive, so the snapshot is refused.
 */
function museRelative(museRoot: string): (value: string) => string {
  return (value) => {
    const relative = path.relative(museRoot, value);
    if (
      !path.isAbsolute(value) ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error("a Muse session path lies outside the Muse root");
    }
    return relative.split(path.sep).join("/");
  };
}

function museIndexProjection(museRoot: string): SqliteProjection {
  const relative = museRelative(museRoot);
  return {
    tables: [
      {
        table: "sessions",
        columns: [
          "session_id",
          "session_dir",
          "session_log_path",
          "layout",
          "workspace_root",
          "git_branch",
          "msp_branch",
          "msp_fork_source_session_id",
          "title",
          "created_at_us",
          "updated_at_us",
        ],
        rewrite: { session_dir: relative, session_log_path: relative },
      },
    ],
  };
}

/** What `history/sources/antigravity` reads from a conversation database. */
const ANTIGRAVITY_CONVERSATION: SqliteProjection = {
  tables: [
    { table: "trajectory_metadata_blob", columns: ["data"] },
    { table: "gen_metadata", columns: ["data"] },
    { table: "steps", columns: ["metadata"] },
  ],
};

const ANTIGRAVITY_SUMMARIES: SqliteProjection = {
  tables: [
    {
      table: "conversation_summaries",
      columns: ["conversation_id", "title", "workspace_uris"],
    },
  ],
};

const ANTIGRAVITY_TRANSCRIPT =
  /^(?<id>[^/]+)\/\.system_generated\/logs\/transcript_full\.jsonl$/u;

/** A stable archive name for an Antigravity root, e.g. `gemini-antigravity-cli`. */
function antigravitySlug(home: string, root: string): string {
  const relative = path.relative(home, root);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Antigravity root is outside the home directory: ${root}`);
  }
  return relative
    .split(path.sep)
    .map((segment) => segment.replace(/^\.+/, ""))
    .join("-");
}

function antigravityRoots(home: string, root: string): SyncRoot[] {
  const slug = antigravitySlug(home, root);
  return [
    {
      tool: "antigravity",
      source: path.join(root, "conversations"),
      kind: "directory",
      archivePrefix: `${slug}/conversations`,
      select: (relative) =>
        /^[^/]+\.db$/u.test(relative)
          ? {
              format: sqlite(ANTIGRAVITY_CONVERSATION),
              group: `${slug}/${path.posix.basename(relative, ".db")}`,
            }
          : null,
    },
    {
      tool: "antigravity",
      source: path.join(root, "brain"),
      kind: "directory",
      archivePrefix: `${slug}/brain`,
      select: (relative) => {
        const id = ANTIGRAVITY_TRANSCRIPT.exec(relative)?.groups?.["id"];
        return id === undefined
          ? null
          : { format: JSONL, group: `${slug}/${id}`, sidecar: true };
      },
    },
    {
      tool: "antigravity",
      source: path.join(root, "conversation_summaries.db"),
      kind: "file",
      archivePrefix: `${slug}/conversation_summaries.db`,
      select: () => ({ format: sqlite(ANTIGRAVITY_SUMMARIES) }),
    },
  ];
}

function agentStoreRoots(home: string): SyncRoot[] {
  const paths = defaultHistoryPaths(home);
  return [
    {
      tool: "grok",
      source: path.join(paths.grokHome, "sessions"),
      kind: "directory",
      archivePrefix: "sessions",
      select: selectGrok,
    },
    {
      tool: "kimi",
      source: paths.kimiSessionsDir,
      kind: "directory",
      archivePrefix: "sessions",
      select: selectKimi,
    },
    {
      tool: "muse",
      source: path.join(paths.museRoot, "session-index.db"),
      kind: "file",
      archivePrefix: "session-index.db",
      select: () => ({
        format: sqlite(museIndexProjection(paths.museRoot)),
      }),
    },
    {
      tool: "muse",
      source: path.join(paths.museRoot, "sessions"),
      kind: "directory",
      archivePrefix: "sessions",
      select: selectMuseLog,
    },
    ...paths.antigravityRoots.flatMap((root) => antigravityRoots(home, root)),
  ];
}

type Environment = Readonly<Record<string, string | undefined>>;

function configuredDirs(
  value: string | undefined,
  home: string,
): string[] | null {
  return value === undefined || value.trim().length === 0
    ? null
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) =>
          entry === "~" || entry.startsWith("~/")
            ? path.join(home, entry.slice(1))
            : entry,
        );
}

/**
 * With more than one config dir, each one's files are kept apart under its
 * own numbered prefix so identical relative paths cannot collide.
 */
function numbered(prefix: string, index: number, count: number): string {
  return count === 1 ? prefix : `${String(index)}/${prefix}`;
}

function selectJsonl(relative: string): FileSelection | null {
  return relative.endsWith(".jsonl") ? { format: { kind: "jsonl" } } : null;
}

export function syncRoots(
  environment: Environment,
  home: string,
  includeDesktopStores = false,
): SyncRoot[] {
  const claudeDirs = configuredDirs(environment["CLAUDE_CONFIG_DIR"], home) ?? [
    path.join(home, ".claude"),
  ];
  const codexDirs = configuredDirs(environment["CODEX_HOME"], home) ?? [
    path.join(home, ".codex"),
  ];
  const roots: SyncRoot[] = [];
  for (const [index, dir] of claudeDirs.entries()) {
    roots.push({
      tool: "claude",
      source: path.join(dir, "projects"),
      kind: "directory",
      archivePrefix: numbered("projects", index, claudeDirs.length),
      select: selectJsonl,
    });
  }
  for (const [index, dir] of codexDirs.entries()) {
    for (const child of ["sessions", "archived_sessions"]) {
      roots.push({
        tool: "codex",
        source: path.join(dir, child),
        kind: "directory",
        archivePrefix: numbered(child, index, codexDirs.length),
        select: selectJsonl,
      });
    }
    roots.push({
      tool: "codex",
      source: path.join(dir, "history.jsonl"),
      kind: "file",
      archivePrefix: numbered("history.jsonl", index, codexDirs.length),
      select: () => ({ format: { kind: "jsonl" } }),
    });
  }
  roots.push(...agentStoreRoots(home));
  if (includeDesktopStores) {
    const paths = defaultHistoryPaths(home);
    roots.push(
      {
        tool: "cursor",
        source: paths.cursorConversationDb,
        kind: "file",
        archivePrefix: "conversation-search.db",
        select: () => ({
          format: sqlite({
            tables: [
              {
                table: "conversations",
                columns: [
                  "fts_rowid",
                  "source",
                  "scope",
                  "id",
                  "title",
                  "updated_at",
                ],
              },
              {
                table: "conversation_fts",
                columns: ["body"],
                preserveRowId: true,
              },
            ],
          }),
        }),
      },
      {
        tool: "conductor",
        source: paths.conductorDb,
        kind: "file",
        archivePrefix: "conductor.db",
        select: () => ({
          format: sqlite({
            tables: [
              {
                table: "sessions",
                columns: [
                  "id",
                  "title",
                  "created_at",
                  "updated_at",
                  "model",
                  "agent_type",
                  "workspace_id",
                ],
              },
              {
                table: "session_messages",
                columns: [
                  "id",
                  "session_id",
                  "role",
                  "content",
                  "full_message",
                  "created_at",
                ],
              },
            ],
          }),
        }),
      },
    );
  }
  return roots;
}
