import os from "node:os";
import path from "node:path";
import { defaultBrimCapturePaths } from "#lib/brim/capture/paths.ts";

export type HistoryPaths = {
  readonly home: string;
  readonly conductorDb: string;
  readonly claudeProjects: string;
  readonly codexDir: string;
  readonly codexCatalogDb: string;
  readonly codexHistoryJsonl: string;
  readonly cursorConversationDb: string;
  readonly antigravityRoots: readonly string[];
  readonly grokHome: string;
  readonly codexSessionsDir: string;
  /** Index of other machines' transcripts pulled by `brim sync pull`. */
  readonly brimSyncMirrorIndex: string;
};

export type HistoryRuntimePaths = {
  readonly historyDir: string;
  readonly indexDb: string;
  readonly usageExportDb: string;
  /** Captured agent requests; not rebuildable, unlike the index. */
  readonly capturesDb: string;
  /** Spool the capture proxy writes and the daemon consumes. */
  readonly captureSpoolDir: string;
  readonly socket: string;
  readonly state: string;
  readonly logsDir: string;
  readonly launchAgent: string;
};

export function defaultHistoryPaths(home = os.homedir()): HistoryPaths {
  return {
    home,
    conductorDb: path.join(
      home,
      "Library/Application Support/com.conductor.app/conductor.db",
    ),
    claudeProjects: path.join(home, ".claude/projects"),
    codexDir: path.join(home, ".codex"),
    codexCatalogDb: path.join(home, ".codex/sqlite/codex-dev.db"),
    codexHistoryJsonl: path.join(home, ".codex/history.jsonl"),
    cursorConversationDb: path.join(
      home,
      "Library/Application Support/Cursor/User/globalStorage/conversation-search.db",
    ),
    antigravityRoots: [
      ".gemini/antigravity",
      ".gemini/antigravity-cli",
      ".gemini/antigravity-ide",
      ".gemini/antigravity-backup",
      ".config/antigravity",
    ].map((root) => path.join(home, root)),
    grokHome: path.join(home, ".grok"),
    codexSessionsDir: path.join(home, ".codex/sessions"),
    brimSyncMirrorIndex: path.join(
      home,
      ".toolkit/brim-sync/mirror/index.json",
    ),
  };
}

export function defaultHistoryRuntimePaths(
  home = os.homedir(),
): HistoryRuntimePaths {
  const historyDir = path.join(home, ".toolkit/history");
  return {
    historyDir,
    indexDb: path.join(historyDir, "index.sqlite"),
    usageExportDb: path.join(historyDir, "usage-export.sqlite"),
    capturesDb: path.join(historyDir, "captures.sqlite"),
    captureSpoolDir: defaultBrimCapturePaths(home).spoolDir,
    socket: path.join(historyDir, "daemon.sock"),
    state: path.join(historyDir, "state.json"),
    logsDir: path.join(historyDir, "logs"),
    launchAgent: path.join(
      home,
      "Library/LaunchAgents/com.jerred.toolkit-history.plist",
    ),
  };
}
