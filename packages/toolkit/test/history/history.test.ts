import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import { parseSince } from "#lib/history/query/query.ts";
import { renderLaunchAgent } from "#lib/history/sources/launchd.ts";
import {
  defaultHistoryRuntimePaths,
  type HistoryPaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import { scanHistorySources } from "#lib/history/serve.ts";
import { readCursorDatabase } from "#lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryRecord,
  UsageEventEntry,
} from "#lib/history/types.ts";

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

// Minimal protobuf encoder matching the wire format
// packages/toolkit/src/lib/history/antigravity/protobuf.ts decodes.
function encodeVarint(value: number, out: number[]): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  out.push(remaining);
}

function encodeBytesField(
  fieldNumber: number,
  bytes: readonly number[],
  out: number[],
): void {
  encodeVarint((fieldNumber << 3) | 2, out);
  encodeVarint(bytes.length, out);
  out.push(...bytes);
}

function encodeVarintField(
  fieldNumber: number,
  value: number,
  out: number[],
): void {
  encodeVarint(fieldNumber << 3, out);
  encodeVarint(value, out);
}

function encodeModelUsage(usage: {
  readonly inputTokens: number;
  readonly totalOutputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly reasoningTokens?: number;
  readonly visibleOutputTokens?: number;
}): number[] {
  const out: number[] = [];
  encodeVarintField(2, usage.inputTokens, out);
  encodeVarintField(3, usage.totalOutputTokens, out);
  if (usage.cacheCreationTokens !== undefined) {
    encodeVarintField(4, usage.cacheCreationTokens, out);
  }
  if (usage.cacheReadTokens !== undefined) {
    encodeVarintField(5, usage.cacheReadTokens, out);
  }
  if (usage.reasoningTokens !== undefined) {
    encodeVarintField(9, usage.reasoningTokens, out);
  }
  if (usage.visibleOutputTokens !== undefined) {
    encodeVarintField(10, usage.visibleOutputTokens, out);
  }
  return out;
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

function writeConductorFixture(conductorDir: string): string {
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
  return conductorDb;
}

async function writeClaudeFixture(claudeDir: string): Promise<void> {
  const claudeFile = path.join(claudeDir, "session.jsonl");
  const usage = {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  await Bun.write(
    claudeFile,
    `${JSON.stringify({ type: "user", sessionId: "claude-session", timestamp: "2026-08-12T00:00:00Z", message: { role: "user", content: "Investigate database migration" } })}\n${JSON.stringify(
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-08-12T00:01:00Z",
        message: {
          id: "msg_claude-usage-dedup-marker",
          role: "assistant",
          model: "claude-sonnet-5",
          usage,
          content: [
            { type: "text", text: "Migration is complete" },
            { type: "thinking", thinking: "omit-claude-reasoning" },
          ],
        },
      },
    )}\n${JSON.stringify(
      // Same API response as the record above (shared message.id), split
      // into a second JSONL line carrying the tool_use block — Claude Code
      // repeats the whole response's cumulative usage on both records, so
      // this must NOT be counted a second time.
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-08-12T00:01:00Z",
        message: {
          id: "msg_claude-usage-dedup-marker",
          role: "assistant",
          model: "claude-sonnet-5",
          usage,
          content: [
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
}

type CodexFixture = {
  readonly codexThread: string;
  readonly codexHistory: string;
  readonly codexCatalog: string;
};

async function writeCodexFixture(codexDir: string): Promise<CodexFixture> {
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
  return { codexThread, codexHistory, codexCatalog };
}

function writeCursorFixture(cursorDir: string): string {
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
  return cursorDb;
}

async function writeOpencodeFixture(opencodeDir: string): Promise<string> {
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
  return opencodeDb;
}

async function writeGrokFixture(grokHome: string): Promise<void> {
  const sessionDir = path.join(
    grokHome,
    "sessions",
    "%2Ftest%2Fproject",
    "grok-session-1",
  );
  await mkdir(sessionDir, { recursive: true });
  const lines = [
    {
      timestamp: 1_788_721_616,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Investigate flaky test" },
        },
      },
    },
    {
      timestamp: 1_788_721_618,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Found the race condition grok-tail-search-marker",
          },
        },
      },
    },
    {
      timestamp: 1_788_721_640,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "tool_call",
          title: "run shell command",
          status: "completed",
          rawInput: {
            command: "curl grok-tool-command-marker",
            env: { API_KEY: "sk-should-not-appear-in-index" },
            password: "sk-should-not-appear-in-index",
          },
        },
      },
    },
    {
      timestamp: 1_788_721_656,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "turn_completed",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cachedReadTokens: 40,
            reasoningTokens: 10,
            costUsdTicks: 18_519_200,
            modelUsage: {
              "grok-4.5-build": {
                inputTokens: 100,
                outputTokens: 20,
                cachedReadTokens: 40,
                reasoningTokens: 10,
                costUsdTicks: 18_519_200,
              },
            },
          },
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionDir, "updates.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );
}

async function writeAntigravityFixture(antigravityRoot: string): Promise<void> {
  const conversationsDir = path.join(antigravityRoot, "conversations");
  await mkdir(conversationsDir, { recursive: true });
  const dbFile = path.join(conversationsDir, "antigravity-session-1.db");
  writeDatabase(
    dbFile,
    "CREATE TABLE steps (idx INTEGER, metadata BLOB);",
    (database) => {
      const usage = encodeModelUsage({
        inputTokens: 500,
        totalOutputTokens: 80,
        cacheReadTokens: 200,
      });
      const modelInfo: number[] = [];
      encodeBytesField(
        12,
        [...new TextEncoder().encode("claude-sonnet-5")],
        modelInfo,
      );
      const metadata: number[] = [];
      encodeBytesField(9, usage, metadata);
      encodeBytesField(24, modelInfo, metadata);
      database
        .prepare("INSERT INTO steps VALUES (1, ?)")
        .run(new Uint8Array(metadata));

      // A reasoning-heavy generation: Gemini reports visible output and
      // reasoning as separate additive fields (no `totalOutputTokens`), so
      // this proves billed output includes reasoning rather than dropping it.
      const reasoningUsage = encodeModelUsage({
        inputTokens: 10,
        totalOutputTokens: 0,
        visibleOutputTokens: 30,
        reasoningTokens: 50,
      });
      const reasoningModelInfo: number[] = [];
      encodeBytesField(
        12,
        [...new TextEncoder().encode("claude-sonnet-5")],
        reasoningModelInfo,
      );
      const reasoningMetadata: number[] = [];
      encodeBytesField(9, reasoningUsage, reasoningMetadata);
      encodeBytesField(24, reasoningModelInfo, reasoningMetadata);
      database
        .prepare("INSERT INTO steps VALUES (2, ?)")
        .run(new Uint8Array(reasoningMetadata));
    },
  );
}

async function writeCodexSessionUsageFixture(
  sessionsDir: string,
): Promise<void> {
  const lines = [
    {
      timestamp: "2026-08-08T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t1", id: "t1" },
    },
    {
      timestamp: "2026-08-08T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-08T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 400,
          cache_write_input_tokens: 0,
          output_tokens: 100,
          reasoning_output_tokens: 20,
          total_tokens: 1100,
        },
      },
    },
    {
      // Deliberately outside a `--since 7d`-from-now window: proves usage
      // aggregation reads this event's own timestamp, not the document's.
      timestamp: "2026-08-14T00:00:00.000Z",
      ordinal: 3,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 50,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 0,
          total_tokens: 60,
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-t1.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  // t-orphan-usage has no thread_history row and no catalog entry — proves
  // usage isn't silently dropped for a rollout the other Codex trees don't
  // otherwise represent (e.g. a CLI-only install with no local history db).
  const orphanLines = [
    {
      timestamp: "2026-08-09T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t-orphan-usage", id: "t-orphan-usage" },
    },
    {
      timestamp: "2026-08-09T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-09T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 40,
          reasoning_output_tokens: 0,
          total_tokens: 340,
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-orphan.jsonl"),
    `${orphanLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-"));
  const conductorDir = path.join(fixtureRoot, "conductor");
  const claudeDir = path.join(fixtureRoot, "claude/projects/project");
  const codexDir = path.join(fixtureRoot, "codex");
  const codexSessionsDir = path.join(fixtureRoot, "codex-sessions");
  const cursorDir = path.join(fixtureRoot, "Cursor data with spaces");
  const opencodeDir = path.join(fixtureRoot, "opencode");
  const grokHome = path.join(fixtureRoot, "grok");
  const antigravityRoot = path.join(fixtureRoot, "antigravity");
  await Promise.all([
    mkdir(conductorDir, { recursive: true }),
    mkdir(claudeDir, { recursive: true }),
    mkdir(codexDir, { recursive: true }),
    mkdir(codexSessionsDir, { recursive: true }),
    mkdir(cursorDir, { recursive: true }),
    mkdir(opencodeDir, { recursive: true }),
  ]);

  const conductorDb = writeConductorFixture(conductorDir);
  await writeClaudeFixture(claudeDir);
  const { codexHistory, codexCatalog } = await writeCodexFixture(codexDir);
  await writeCodexSessionUsageFixture(codexSessionsDir);
  const cursorDb = writeCursorFixture(cursorDir);
  const opencodeDb = await writeOpencodeFixture(opencodeDir);
  await writeGrokFixture(grokHome);
  await writeAntigravityFixture(antigravityRoot);

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
    antigravityRoots: [antigravityRoot],
    grokHome,
    codexSessionsDir,
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

describe("history source usage and redaction", () => {
  test("dedupes Claude usage records that share one response's message id", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const claude = documents.find((document) => document.source === "claude");
    expect(claude?.usageEvents).toHaveLength(1);
    expect(claude?.usageEvents[0]?.inputTokens).toBe(1000);
    expect(claude?.usageEvents[0]?.outputTokens).toBe(200);
  });

  test("attributes Codex usage per turn, keeping cached input a subset of input", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const codexThread = documents.find(
      (document) => document.source === "codex" && document.runtimeId === "t1",
    );
    expect(codexThread?.usageEvents).toHaveLength(2);
    const [firstTurn, secondTurn] = codexThread?.usageEvents ?? [];
    expect(firstTurn?.occurredAt).toBe("2026-08-08T00:00:02.000Z");
    expect(firstTurn?.model).toBe("gpt-5.6-sol");
    expect(firstTurn?.inputTokens).toBe(1000);
    expect(firstTurn?.cachedInputTokens).toBe(400);
    expect(firstTurn?.cacheReadTokens).toBe(0);
    expect(secondTurn?.occurredAt).toBe("2026-08-14T00:00:00.000Z");
    expect(secondTurn?.inputTokens).toBe(50);
  });

  test("retains Codex usage for a rollout with no thread-history or catalog row", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const orphan = documents.find(
      (document) =>
        document.source === "codex" && document.runtimeId === "t-orphan-usage",
    );
    expect(orphan).toBeDefined();
    expect(orphan?.usageEvents).toHaveLength(1);
    expect(orphan?.usageEvents[0]?.inputTokens).toBe(300);
  });

  test("redacts secrets out of Grok tool call raw input before indexing", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const grok = documents.find((document) => document.source === "grok");
    expect(grok?.toolOutputText).toContain("grok-tool-command-marker");
    expect(grok?.toolOutputText).not.toContain("sk-should-not-appear-in-index");
  });

  test("bills Antigravity reasoning tokens as part of output, not dropped", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const antigravity = documents.find(
      (document) => document.source === "antigravity",
    );
    const reasoningEvent = antigravity?.usageEvents.find(
      (event) => event.reasoningTokens > 0,
    );
    // Gemini reported this generation as 30 visible + 50 reasoning output
    // tokens, separately — the billable outputTokens must be their sum (80),
    // with reasoningTokens (50) reported only as an informational subset.
    expect(reasoningEvent?.outputTokens).toBe(80);
    expect(reasoningEvent?.reasoningTokens).toBe(50);
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
    expect(parseSince("all", now)).toBeNull();
    expect(parseSince("ALL", now)).toBeNull();
  });

  test("aggregates token usage and cost, flagging unpriced models as incomplete", async () => {
    const runtimePaths = defaultHistoryRuntimePaths(
      path.join(fixtureRoot, "usage-home"),
    );
    const index = await HistoryIndex.open(runtimePaths);
    const pricedEvent: UsageEventEntry = {
      occurredAt: "2026-08-10T00:00:00.000Z",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costUsd: 1.23,
      costComplete: true,
    };
    const pricedDocument: HistoryDocument = {
      source: "claude",
      sourceId: "priced-1",
      title: "Priced session",
      path: "/fixture/priced-1",
      workspace: "/fixture",
      agent: "Claude Code",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      runtimeId: "priced-1",
      openingPromptHash: null,
      dialogueText: "priced",
      toolOutputText: "",
      usageEvents: [pricedEvent],
    };
    const unpricedEvent: UsageEventEntry = {
      occurredAt: "2026-08-10T00:00:00.000Z",
      model: "some-unpriced-model",
      inputTokens: 500,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costUsd: null,
      costComplete: false,
    };
    const unpricedDocument: HistoryDocument = {
      ...pricedDocument,
      sourceId: "unpriced-1",
      title: "Unpriced session",
      path: "/fixture/unpriced-1",
      runtimeId: "unpriced-1",
      dialogueText: "unpriced",
      usageEvents: [unpricedEvent],
    };
    await index.ingest([
      {
        source: "claude",
        available: true,
        documents: [pricedDocument, unpricedDocument],
        fingerprint: "usage-fixture",
        error: null,
      },
    ]);

    const report = index.usage({ since: null, source: null });
    expect(report.total.documentCount).toBe(2);
    expect(report.total.inputTokens).toBe(1500);
    expect(report.total.outputTokens).toBe(250);
    expect(report.total.costUsd).toBeCloseTo(1.23);
    expect(report.total.costComplete).toBe(false);
    expect(report.bySource).toHaveLength(1);
    expect(report.bySource[0]?.source).toBe("claude");
    expect(report.bySource[0]?.documentCount).toBe(2);

    const scoped = index.usage({ since: null, source: "codex" });
    expect(scoped.total.documentCount).toBe(0);
    expect(scoped.bySource).toHaveLength(0);
    index.close();
  });

  test("filters usage by event time, not by the document's last update", async () => {
    const runtimePaths = defaultHistoryRuntimePaths(
      path.join(fixtureRoot, "usage-window-home"),
    );
    const index = await HistoryIndex.open(runtimePaths);
    const oldEvent: UsageEventEntry = {
      occurredAt: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-5",
      inputTokens: 100_000,
      outputTokens: 20_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costUsd: 100,
      costComplete: true,
    };
    const recentEvent: UsageEventEntry = {
      occurredAt: "2026-08-15T00:00:00.000Z",
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.1,
      costComplete: true,
    };
    const longLivedDocument: HistoryDocument = {
      source: "claude",
      sourceId: "long-lived-1",
      title: "Months-long session",
      path: "/fixture/long-lived-1",
      workspace: "/fixture",
      agent: "Claude Code",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      runtimeId: "long-lived-1",
      openingPromptHash: null,
      dialogueText: "long-lived",
      toolOutputText: "",
      usageEvents: [oldEvent, recentEvent],
    };
    await index.ingest([
      {
        source: "claude",
        available: true,
        documents: [longLivedDocument],
        fingerprint: "usage-window-fixture",
        error: null,
      },
    ]);

    // The document's updated_at (2026-08-15) falls inside a `--since 2026-08-01`
    // window, but only the recent event's tokens/cost should count — not the
    // whole document's lifetime total, which also includes January's event.
    const allTime = index.usage({ since: null, source: null });
    expect(allTime.total.costUsd).toBeCloseTo(100.1);
    expect(allTime.total.documentCount).toBe(1);

    const recentOnly = index.usage({
      since: "2026-08-01T00:00:00.000Z",
      source: null,
    });
    expect(recentOnly.total.costUsd).toBeCloseTo(0.1);
    expect(recentOnly.total.inputTokens).toBe(100);
    expect(recentOnly.total.documentCount).toBe(1);
    index.close();
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
