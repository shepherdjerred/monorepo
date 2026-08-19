import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import { parseSince } from "#lib/history/query.ts";
import { renderLaunchAgent } from "#lib/history/launchd.ts";
import {
  defaultHistoryRuntimePaths,
  type HistoryPaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import { scanHistorySources } from "#lib/history/serve.ts";
import { readCursorDatabase } from "#lib/history/sources-shared.ts";
import type { HistoryDocument, HistoryRecord } from "#lib/history/types.ts";

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

function seedLongConductorSession(database: Database): void {
  database.run(
    "INSERT INTO sessions VALUES ('s-long', 'Long session', '2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', 'model', 'agent', 'workspace')",
  );
  const insertMessage = database.prepare(
    "INSERT INTO session_messages VALUES (?, 's-long', 'assistant', ?, NULL, ?)",
  );
  const insertMessages = database.transaction(() => {
    for (let index = 0; index < 1100; index += 1) {
      insertMessage.run(
        `long-${String(index).padStart(4, "0")}`,
        index === 400
          ? "middle-search-marker substantive dialogue"
          : `routine dialogue ${String(index)}`,
        new Date(Date.UTC(2026, 7, 10, 0, 0, index)).toISOString(),
      );
    }
  });
  insertMessages();
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-"));
  const conductorDir = path.join(fixtureRoot, "conductor");
  const claudeDir = path.join(fixtureRoot, "claude/projects/project");
  const codexDir = path.join(fixtureRoot, "codex");
  const cursorDir = path.join(fixtureRoot, "Cursor data with spaces");
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
        "INSERT INTO sessions VALUES ('s-empty', 'Empty session', '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z', 'model', 'agent', 'workspace')",
      );
      database.run(
        "INSERT INTO session_messages VALUES ('m1', 's1', 'user', 'Fix kubernetes ingress', NULL, '2026-08-10T00:00:00Z')",
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m2', 's1', 'assistant', '${JSON.stringify(
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Substantive ingress dialogue" },
                { type: "thinking", thinking: "omit-conductor-reasoning" },
                {
                  type: "tool_use",
                  name: "shell",
                  input: { command: "kubectl get ingress" },
                },
              ],
            },
          },
        ).replaceAll("'", "''")}', NULL, '2026-08-10T00:01:00Z')`,
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m3', 's1', 'assistant', '${JSON.stringify({ type: "user", message: { role: "user", content: "<system_instruction>omit-conductor-system</system_instruction>" } }).replaceAll("'", "''")}', NULL, '2026-08-10T00:02:00Z')`,
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m4', 's1', 'assistant', '${JSON.stringify(
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "x".repeat(40_000) },
                { type: "text", text: "later-content-block-marker" },
              ],
            },
          },
        ).replaceAll("'", "''")}', NULL, '2026-08-10T00:03:00Z')`,
      );
      seedLongConductorSession(database);
    },
  );

  const claudeFile = path.join(claudeDir, "session.jsonl");
  await Bun.write(
    claudeFile,
    `${JSON.stringify({ type: "user", sessionId: "claude-session", timestamp: "2026-08-12T00:00:00Z", message: { role: "user", content: "Investigate database migration" } })}\n${JSON.stringify(
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-08-12T00:01:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Migration is complete" },
            { type: "thinking", thinking: "omit-claude-reasoning" },
            {
              type: "tool_use",
              name: "shell",
              input: { command: "bun test migration" },
            },
          ],
        },
      },
    )}\n${JSON.stringify({ type: "system", timestamp: "2026-08-12T00:02:00Z", content: "omit-claude-system" })}\n`,
  );

  const codexThread = path.join(codexDir, "thread_history_1.sqlite");
  writeDatabase(
    codexThread,
    "CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT, updated_at_ordinal INTEGER, PRIMARY KEY (thread_id, turn_id, item_id));",
    (database) => {
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'item', 1, 1786406400000, '{\"type\":\"userMessage\",\"text\":\"Repair Buildkite pipeline\"}', 'userMessage', 0)",
      );
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'reasoning', 2, 1786406401000, '{\"text\":\"omit-codex-reasoning\"}', 'reasoning', 0)",
      );
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'tool', 3, 1786406402000, '{\"command\":\"bk build view\"}', 'commandExecution', 0)",
      );
    },
  );
  const codexHistory = path.join(codexDir, "history.jsonl");
  await Bun.write(
    codexHistory,
    `${JSON.stringify({ session_id: "history-session", timestamp: "2026-08-13T00:00:00Z", prompt: "Review deployment status" })}\nnot-json\n"scalar prompt"\n${JSON.stringify({ session_id: "metadata-only" })}\n`,
  );
  const codexCatalog = path.join(codexDir, "codex-dev.db");
  writeDatabase(
    codexCatalog,
    "CREATE TABLE local_thread_catalog (host_id TEXT, thread_id TEXT, display_title TEXT, source_created_at REAL, source_updated_at REAL, cwd TEXT, model_provider TEXT, git_branch TEXT, missing_candidate INTEGER);",
    (database) => {
      database.run(
        "INSERT INTO local_thread_catalog VALUES ('host', 't1', 'Cataloged work', 1786406400, 1786406400, '/workspace', 'openai', 'main', 0)",
      );
      database.run(
        "INSERT INTO local_thread_catalog VALUES ('host', 't2', 'Catalog only', 1786406400, 1786406400, '/catalog', 'openai', 'feature', 0)",
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
      database
        .prepare(
          "INSERT INTO conversation_fts(rowid, title, body) VALUES (1, ?, ?)",
        )
        .run(
          "Cursor fix",
          `Resolve TypeScript typecheck ${"routine cursor context ".repeat(1000)}cursor-tail-search-marker`,
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
        'INSERT INTO message VALUES (\'om2\', \'o1\', \'{"role":"assistant","text":"Later direct message"}\', 1786406405000, 1786406405000)',
      );
      database.run(
        "INSERT INTO part VALUES ('op1', 'om1', 'o1', 1786406400000, 1786406400000, '{\"type\":\"text\",\"text\":\"Improve launchd ingestion\"}')",
      );
      database.run(
        "INSERT INTO part VALUES ('op2', 'om1', 'o1', 1786406400001, 1786406400001, '{\"type\":\"reasoning\",\"text\":\"omit-opencode-reasoning\"}')",
      );
      database.run(
        "INSERT INTO part VALUES ('op3', 'om1', 'o1', 1786406400002, 1786406400002, '{\"type\":\"tool\",\"command\":\"launchctl print fixture\"}')",
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
          `${document.dialogueText}\n${document.toolOutputText}`.includes(
            "must-not-be-indexed",
          ),
        ),
    ).toBe(false);
  });

  test("classifies dialogue and tool text while omitting private control records", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const conductor = documents.find(
      (document) => document.source === "conductor",
    );
    const claude = documents.find((document) => document.source === "claude");
    const codex = documents.find(
      (document) =>
        document.source === "codex" && document.path.includes("thread_history"),
    );
    const opencode = documents.find(
      (document) => document.source === "opencode-conductor",
    );
    expect(conductor?.dialogueText).toContain("Substantive ingress dialogue");
    expect(conductor?.toolOutputText).toContain("kubectl get ingress");
    expect(conductor?.dialogueText).not.toContain("omit-conductor");
    expect(claude?.dialogueText).toContain("Migration is complete");
    expect(claude?.toolOutputText).toContain("bun test migration");
    expect(claude?.dialogueText).not.toContain("omit-claude");
    expect(codex?.dialogueText).toContain("Repair Buildkite pipeline");
    expect(codex?.toolOutputText).toContain("bk build view");
    expect(codex?.dialogueText).not.toContain("omit-codex-reasoning");
    expect(opencode?.dialogueText).toContain("Improve launchd ingestion");
    expect(
      opencode?.dialogueText.indexOf("Improve launchd ingestion"),
    ).toBeLessThan(
      opencode?.dialogueText.indexOf("Later direct message") ?? -1,
    );
    expect(opencode?.toolOutputText).toContain("launchctl print fixture");
    expect(opencode?.dialogueText).not.toContain("omit-opencode-reasoning");
    const codexThreadCopies = documents.filter(
      (document) => document.source === "codex" && document.runtimeId === "t1",
    );
    expect(codexThreadCopies).toHaveLength(1);
    expect(codexThreadCopies[0]?.title).toBe("Cataloged work");
    expect(codexThreadCopies[0]?.workspace).toBe("/workspace");
    expect(codexThreadCopies[0]?.toolOutputText).toContain("main");
  });

  test("retains Cursor tails and rejects malformed Codex history lines", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const codexPrompts = documents.filter(
      (document) =>
        document.source === "codex" && document.path.endsWith("history.jsonl"),
    );
    const cursor = documents.find((document) => document.source === "cursor");

    expect(codexPrompts).toHaveLength(1);
    expect(codexPrompts[0]?.runtimeId).toBe("history-session");
    expect(cursor?.dialogueText).toContain("cursor-tail-search-marker");
  });

  test("indexes middle messages and later oversized Conductor blocks", async () => {
    const conductor = createHistorySources().find(
      (source) => source.name === "conductor",
    );
    if (conductor === undefined) {
      throw new Error("Conductor source is missing");
    }
    const scanned = await conductor.scan(paths);
    const longSession = scanned.documents.find(
      (document) => document.sourceId === "s-long",
    );
    const oversizedBlocks = scanned.documents.find(
      (document) => document.sourceId === "s1",
    );

    expect(longSession?.dialogueText).toContain("middle-search-marker");
    expect(oversizedBlocks?.dialogueText).toContain(
      "later-content-block-marker",
    );
  });

  test("returns indexed Codex catalog metadata from targeted reads", async () => {
    const codexSource = createHistorySources().find(
      (source) => source.name === "codex",
    );
    if (codexSource === undefined) {
      throw new Error("Codex source is missing");
    }
    const scanned = await codexSource.scan(paths);
    const thread = scanned.documents.find(
      (document) => document.runtimeId === "t1",
    );
    const catalogOnly = scanned.documents.find(
      (document) => document.runtimeId === "t2",
    );
    const codexRecords = [thread, catalogOnly].flatMap((document, index) =>
      document === undefined ? [] : [recordFromDocument(document, index + 1)],
    );
    const codexMessages = await codexSource.read(paths, codexRecords);
    expect([...codexMessages.messages.values()].flat()).toContainEqual(
      expect.objectContaining({
        role: "tool",
        text: expect.stringContaining("main"),
      }),
    );
    expect([...codexMessages.messages.values()].flat()).toContainEqual(
      expect.objectContaining({
        role: "tool",
        text: expect.stringContaining("feature"),
      }),
    );
  });

  test("scans history sources with bounded concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const sources = Array.from({ length: 5 }, (_, index) => ({
      name: "conductor" as const,
      label: `Fixture ${String(index)}`,
      scan: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(5);
        active -= 1;
        return {
          source: "conductor" as const,
          available: true,
          documents: [],
          fingerprint: String(index),
          error: null,
        };
      },
      read: async () => ({
        source: "conductor" as const,
        messages: new Map(),
        missingSourceIds: [],
        error: null,
      }),
    }));

    const results = await scanHistorySources(sources, paths);

    expect(results).toHaveLength(5);
    expect(maximumActive).toBe(2);
  });
});

describe("history source adapter reads", () => {
  test("performs batched reads only for selected indexed records", async () => {
    const sources = createHistorySources();
    for (const source of sources) {
      const scanned = await source.scan(paths);
      const document = scanned.documents[0];
      expect(document).toBeDefined();
      if (document === undefined) {
        throw new Error(`Missing ${source.name} fixture document`);
      }
      const record = recordFromDocument(document, 1);
      const selected = await source.read(paths, [record]);
      expect(selected.error).toBeNull();
      expect(selected.missingSourceIds).toEqual([]);
      expect([...selected.messages.keys()]).toEqual([document.sourceId]);
      expect(
        [...selected.messages.values()]
          .flat()
          .some((message) => message.text.includes("must-not-be-indexed")),
      ).toBe(false);
      if (source.name === "cursor") {
        expect(selected.messages.get(document.sourceId)?.[0]?.role).toBe(
          "unknown",
        );
      }
    }
  });

  test("distinguishes an empty source record from a missing one", async () => {
    const source = createHistorySources().find(
      (entry) => entry.name === "conductor",
    );
    if (source === undefined) {
      throw new Error("Conductor source is missing");
    }
    const scanned = await source.scan(paths);
    const empty = scanned.documents.find(
      (document) => document.sourceId === "s-empty",
    );
    if (empty === undefined) {
      throw new Error("Empty Conductor fixture was not indexed");
    }
    const emptyRecord = recordFromDocument(empty, 1);
    const missingRecord = {
      ...emptyRecord,
      id: 2,
      sourceId: "missing-session",
    };

    const selected = await source.read(paths, [emptyRecord, missingRecord]);

    expect(selected.error).toBeNull();
    expect(selected.messages.get("s-empty")).toEqual([]);
    expect(selected.missingSourceIds).toEqual(["missing-session"]);
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

  test("opens immutable Cursor data from a path with spaces", async () => {
    const immutableDir = path.join(fixtureRoot, "immutable Cursor fixture");
    await mkdir(immutableDir, { recursive: true });
    const immutablePath = path.join(immutableDir, "conversation search.db");
    writeDatabase(
      immutablePath,
      "CREATE TABLE fixture (value TEXT);",
      (database) => {
        database.run("PRAGMA journal_mode = WAL");
        database.run("INSERT INTO fixture VALUES ('readable')");
      },
    );
    await chmod(immutablePath, 0o400);
    await chmod(immutableDir, 0o500);
    try {
      let ordinaryAttempted = false;
      const database = await readCursorDatabase(immutablePath, () => {
        ordinaryAttempted = true;
        throw new Error("SQLITE_CANTOPEN: fixture ordinary read failed");
      });
      expect(ordinaryAttempted).toBe(true);
      const row = database.query("SELECT value FROM fixture").get();
      expect(row).toEqual({ value: "readable" });
      database.close();

      await chmod(immutableDir, 0o700);
      await Bun.write(`${immutablePath}-wal`, "live WAL fixture");
      await expect(
        readCursorDatabase(immutablePath, () => {
          throw new Error("SQLITE_CANTOPEN: fixture ordinary read failed");
        }),
      ).rejects.toThrow("live WAL is present");
      await rm(`${immutablePath}-wal`);
    } finally {
      await chmod(immutableDir, 0o700);
    }
  });
});

function recordFromDocument(
  document: HistoryDocument,
  id: number,
): HistoryRecord {
  return {
    id,
    source: document.source,
    sourceId: document.sourceId,
    title: document.title,
    path: document.path,
    workspace: document.workspace,
    agent: document.agent,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    excerpt: null,
  };
}

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
      index.search("database", { since: null, source: "claude" }),
    ).toHaveLength(1);
    expect(
      index.search("database migration", {
        since: null,
        source: null,
      }),
    ).toHaveLength(1);
    expect(
      index.search("database", { since: null, source: "codex" }),
    ).toHaveLength(0);

    await index.ingest([
      { ...first, fingerprint: `${first.fingerprint}:changed`, documents: [] },
    ]);
    expect(
      index.search("database", { since: null, source: "claude" }),
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
