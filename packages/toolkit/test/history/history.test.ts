import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex, parseSince } from "#lib/history/index.ts";
import { renderLaunchAgent } from "#lib/history/launchd.ts";
import {
  defaultHistoryRuntimePaths,
  type HistoryPaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";

let fixtureRoot = "";
let paths: HistoryPaths;

function writeDatabase(
  filePath: string,
  schema: string,
  seed: (database: Database) => void,
): void {
  const database = new Database(filePath);
  database.run(schema);
  seed(database);
  database.close();
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-"));
  const conductorDir = path.join(fixtureRoot, "conductor");
  const claudeDir = path.join(fixtureRoot, "claude/projects/project");
  const codexDir = path.join(fixtureRoot, "codex");
  const cursorDir = path.join(fixtureRoot, "cursor");
  const opencodeDir = path.join(fixtureRoot, "opencode");
  await Promise.all([
    mkdir(conductorDir, { recursive: true }),
    mkdir(claudeDir, { recursive: true }),
    mkdir(codexDir, { recursive: true }),
    mkdir(cursorDir, { recursive: true }),
    mkdir(opencodeDir, { recursive: true }),
  ]);

  const conductorDb = path.join(conductorDir, "conductor.db");
  writeDatabase(
    conductorDb,
    `
      CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT,
        model TEXT, agent_type TEXT, workspace_id TEXT);
      CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
        full_message TEXT, created_at TEXT);
    `,
    (database) => {
      database.run(
        "INSERT INTO sessions VALUES ('s1', 'Ingress repair', '2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', 'model', 'agent', 'workspace')",
      );
      database.run(
        "INSERT INTO session_messages VALUES ('m1', 's1', 'user', 'Fix kubernetes ingress', NULL, '2026-08-10T00:00:00Z')",
      );
    },
  );

  const claudeFile = path.join(claudeDir, "session.jsonl");
  await Bun.write(
    claudeFile,
    `${JSON.stringify({ type: "user", timestamp: "2026-08-12T00:00:00Z", message: { content: "Investigate database migration" } })}\n${JSON.stringify({ type: "assistant", timestamp: "2026-08-12T00:01:00Z", message: { content: [{ type: "text", text: "Migration is complete" }] } })}\n`,
  );

  const codexThread = path.join(codexDir, "thread_history_1.sqlite");
  writeDatabase(
    codexThread,
    "CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT, updated_at_ordinal INTEGER, PRIMARY KEY (thread_id, turn_id, item_id));",
    (database) => {
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'item', 1, 1786406400000, '{\"type\":\"userMessage\",\"text\":\"Repair Buildkite pipeline\"}', 'userMessage', 0)",
      );
    },
  );
  const codexHistory = path.join(codexDir, "history.jsonl");
  await Bun.write(
    codexHistory,
    `${JSON.stringify({ timestamp: "2026-08-13T00:00:00Z", prompt: "Review deployment status" })}\n`,
  );
  const codexCatalog = path.join(codexDir, "codex-dev.db");
  writeDatabase(
    codexCatalog,
    "CREATE TABLE local_thread_catalog (host_id TEXT, thread_id TEXT, display_title TEXT, source_created_at REAL, source_updated_at REAL, cwd TEXT, model_provider TEXT, git_branch TEXT, missing_candidate INTEGER);",
    (database) => {
      database.run(
        "INSERT INTO local_thread_catalog VALUES ('host', 't1', 'Cataloged work', 1786406400, 1786406400, '/workspace', 'openai', 'main', 0)",
      );
    },
  );

  const cursorDb = path.join(cursorDir, "conversation-search.db");
  writeDatabase(
    cursorDb,
    `
      CREATE TABLE conversations (fts_rowid INTEGER PRIMARY KEY, source TEXT, scope TEXT, id TEXT,
        title TEXT, updated_at INTEGER, is_archived INTEGER, root_fingerprint TEXT, cache_fingerprint TEXT);
      CREATE VIRTUAL TABLE conversation_fts USING fts5(title, body);
    `,
    (database) => {
      database.run(
        "INSERT INTO conversations VALUES (1, 'local', '', 'c1', 'Cursor fix', 1786406400000, 0, 'root', NULL)",
      );
      database.run(
        "INSERT INTO conversation_fts(rowid, title, body) VALUES (1, 'Cursor fix', 'Resolve TypeScript typecheck')",
      );
    },
  );

  const opencodeDb = path.join(opencodeDir, "opencode.db");
  writeDatabase(
    opencodeDb,
    `
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, agent TEXT, model TEXT,
        time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    `,
    (database) => {
      database.run(
        "INSERT INTO session VALUES ('o1', 'OpenCode work', '/workspace', 'build', 'model', 1786406400000, 1786406400000)",
      );
      database.run(
        "INSERT INTO message VALUES ('om1', 'o1', '{\"role\":\"user\"}', 1786406400000, 1786406400000)",
      );
      database.run(
        "INSERT INTO part VALUES ('op1', 'om1', 'o1', 1786406400000, 1786406400000, '{\"type\":\"text\",\"text\":\"Improve launchd ingestion\"}')",
      );
    },
  );
  await Bun.write(
    path.join(opencodeDir, "auth.json"),
    JSON.stringify({ token: "must-not-be-indexed" }),
  );

  paths = {
    home: fixtureRoot,
    conductorDb,
    conductorOpenCodeDb: opencodeDb,
    claudeProjects: path.join(fixtureRoot, "claude/projects"),
    codexDir,
    codexCatalogDb: codexCatalog,
    codexHistoryJsonl: codexHistory,
    cursorConversationDb: cursorDb,
    standaloneOpenCodeDb: opencodeDb,
    standaloneOpenCodeAuth: path.join(opencodeDir, "auth.json"),
  };
});

afterAll(async () => {
  if (fixtureRoot.length > 0) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe("history source adapters", () => {
  test("reads every supported source without reading auth.json", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(
      results.flatMap((result) => result.documents).length,
    ).toBeGreaterThanOrEqual(7);
    expect(
      results
        .flatMap((result) => result.documents)
        .some((document) =>
          document.searchText.includes("must-not-be-indexed"),
        ),
    ).toBe(false);
  });

  test("reports missing sources without pretending they are indexed", async () => {
    const missingPaths = {
      ...paths,
      conductorDb: path.join(fixtureRoot, "missing.db"),
    };
    const source = createHistorySources().find(
      (entry) => entry.name === "conductor",
    );
    expect(source).toBeDefined();
    const result = await source?.scan(missingPaths);
    expect(result?.available).toBe(false);
    expect(result?.documents).toHaveLength(0);
  });
});

describe("history index", () => {
  test("searches, updates, deletes, and filters indexed work", async () => {
    const runtimePaths = defaultHistoryRuntimePaths(
      path.join(fixtureRoot, "home"),
    );
    const index = await HistoryIndex.open(runtimePaths);
    const source = createHistorySources().find(
      (entry) => entry.name === "claude",
    );
    expect(source).toBeDefined();
    const first = await source?.scan(paths);
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("Claude source fixture was not created");
    }
    await index.ingest([first]);
    expect(
      index.search("database", { since: null, source: "claude", limit: 20 }),
    ).toHaveLength(1);
    expect(
      index.search("database migration", {
        since: null,
        source: null,
        limit: 20,
      }),
    ).toHaveLength(1);
    expect(
      index.search("database", { since: null, source: "codex", limit: 20 }),
    ).toHaveLength(0);

    await index.ingest([
      { ...first, fingerprint: `${first.fingerprint}:changed`, documents: [] },
    ]);
    expect(
      index.search("database", { since: null, source: "claude", limit: 20 }),
    ).toHaveLength(0);
    index.close();
  });

  test("parses useful recency windows", () => {
    const now = new Date("2026-08-16T00:00:00Z");
    expect(parseSince("7d", now)).toBe("2026-08-09T00:00:00.000Z");
    expect(parseSince("24h", now)).toBe("2026-08-15T00:00:00.000Z");
    expect(parseSince("2026-08-01", now)).toBe("2026-08-01T00:00:00.000Z");
  });
});

test("renders a private LaunchAgent with automatic restart", () => {
  const runtimePaths = defaultHistoryRuntimePaths("/Users/tester");
  const plist = renderLaunchAgent(runtimePaths);
  expect(plist).toContain("com.jerred.toolkit-history");
  expect(plist).toContain("<key>RunAtLoad</key>");
  expect(plist).toContain("<key>KeepAlive</key>");
  expect(plist).toContain("/Users/tester/.toolkit/history/logs");
  expect(plist).not.toContain("auth.json");
});
