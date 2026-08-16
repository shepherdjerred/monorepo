import os from "node:os";
import path from "node:path";

export type HistoryPaths = {
  readonly home: string;
  readonly conductorDb: string;
  readonly conductorOpenCodeDb: string;
  readonly claudeProjects: string;
  readonly codexDir: string;
  readonly codexCatalogDb: string;
  readonly codexHistoryJsonl: string;
  readonly cursorConversationDb: string;
  readonly standaloneOpenCodeDb: string;
  readonly standaloneOpenCodeAuth: string;
};

export type HistoryRuntimePaths = {
  readonly historyDir: string;
  readonly indexDb: string;
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
    conductorOpenCodeDb: path.join(
      home,
      "Library/Application Support/com.conductor.app/opencode/opencode.db",
    ),
    claudeProjects: path.join(home, ".claude/projects"),
    codexDir: path.join(home, ".codex"),
    codexCatalogDb: path.join(home, ".codex/sqlite/codex-dev.db"),
    codexHistoryJsonl: path.join(home, ".codex/history.jsonl"),
    cursorConversationDb: path.join(
      home,
      "Library/Application Support/Cursor/User/globalStorage/conversation-search.db",
    ),
    standaloneOpenCodeDb: path.join(home, ".local/share/opencode/opencode.db"),
    standaloneOpenCodeAuth: path.join(home, ".local/share/opencode/auth.json"),
  };
}

export function defaultHistoryRuntimePaths(
  home = os.homedir(),
): HistoryRuntimePaths {
  const historyDir = path.join(home, ".toolkit/history");
  return {
    historyDir,
    indexDb: path.join(historyDir, "index.sqlite"),
    socket: path.join(historyDir, "daemon.sock"),
    state: path.join(historyDir, "state.json"),
    logsDir: path.join(historyDir, "logs"),
    launchAgent: path.join(
      home,
      "Library/LaunchAgents/com.jerred.toolkit-history.plist",
    ),
  };
}
