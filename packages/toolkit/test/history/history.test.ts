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
import { writeAntigravityFixture } from "./history-fixtures/antigravity.ts";
import { writeClaudeFixture } from "./history-fixtures/claude.ts";
import {
  writeCodexFixture,
  writeCodexRolloutFormatFixtures,
  writeCodexSessionUsageFixture,
} from "./history-fixtures/codex.ts";
import { writeConductorFixture } from "./history-fixtures/conductor.ts";
import { writeCursorFixture } from "./history-fixtures/cursor.ts";
import { writeDatabase } from "./history-fixtures/database.ts";
import { writeGrokFixture } from "./history-fixtures/grok.ts";
import { writeOpencodeFixture } from "./history-fixtures/opencode.ts";

let fixtureRoot = "";
let paths: HistoryPaths;

function compareStrings(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

async function scanGrokTurnCompletedFixture(
  homeSuffix: string,
  sessionId: string,
  usage: Record<string, unknown>,
) {
  const grokHome = path.join(fixtureRoot, homeSuffix);
  const sessionDir = path.join(
    grokHome,
    "sessions",
    "%2Ftest%2Ffixture",
    sessionId,
  );
  await mkdir(sessionDir, { recursive: true });
  await Bun.write(
    path.join(sessionDir, "updates.jsonl"),
    `${JSON.stringify({
      timestamp: 1_788_721_616,
      params: {
        sessionId,
        update: { sessionUpdate: "turn_completed", usage },
      },
    })}\n`,
  );
  const source = createHistorySources().find((entry) => entry.name === "grok");
  expect(source).toBeDefined();
  return source?.scan({ ...paths, grokHome });
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
  await writeCodexRolloutFormatFixtures(codexSessionsDir);
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

    // "not-json" and the scalar-string line are malformed/unusable and must
    // not become documents; "history-session" and the two "t-multi-prompt"
    // prompts are the only valid, indexable entries in the fixture.
    expect(codexPrompts).toHaveLength(3);
    expect(
      codexPrompts.map((document) => document.runtimeId).sort(compareStrings),
    ).toEqual(
      ["history-session", "t-multi-prompt", "t-multi-prompt"].sort(
        compareStrings,
      ),
    );
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
        document.source === "codex" && document.runtimeId === "t-truly-orphan",
    );
    expect(orphan).toBeDefined();
    expect(orphan?.usageEvents).toHaveLength(1);
    expect(orphan?.usageEvents[0]?.inputTokens).toBe(300);
  });

  test("attaches a multi-prompt Codex session's usage to only one document", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const multiPrompt = documents.filter(
      (document) =>
        document.source === "codex" && document.runtimeId === "t-multi-prompt",
    );
    expect(multiPrompt).toHaveLength(2);
    const withUsage = multiPrompt.filter(
      (document) => document.usageEvents.length > 0,
    );
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0]?.usageEvents[0]?.inputTokens).toBe(500);
  });

  test("captures Codex usage from the current token_count/turn_context event shapes", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const currentFormat = documents.find(
      (document) =>
        document.source === "codex" &&
        document.runtimeId === "t-current-format",
    );
    expect(currentFormat).toBeDefined();
    expect(currentFormat?.usageEvents).toHaveLength(1);
    const event = currentFormat?.usageEvents[0];
    expect(event?.model).toBe("gpt-5.6-terra");
    expect(event?.inputTokens).toBe(700);
    expect(event?.cachedInputTokens).toBe(100);
    expect(event?.outputTokens).toBe(90);
  });

  test("prefers current-format Codex events wholesale when a file has both formats", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const bothFormats = documents.find(
      (document) =>
        document.source === "codex" &&
        document.runtimeId === "t-both-formats-present",
    );
    expect(bothFormats).toBeDefined();
    expect(bothFormats?.usageEvents).toHaveLength(1);
    expect(bothFormats?.usageEvents[0]?.inputTokens).toBe(999);
  });

  test("keeps two distinct Codex turns that coincidentally report identical token counts", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const repeatedFormat = documents.find(
      (document) =>
        document.source === "codex" &&
        document.runtimeId === "t-repeated-format",
    );
    expect(repeatedFormat).toBeDefined();
    expect(repeatedFormat?.usageEvents).toHaveLength(2);
    expect(
      repeatedFormat?.usageEvents.every((event) => event.inputTokens === 333),
    ).toBe(true);
  });

  test("never indexes Grok tool call raw input, only its fixed title/status", async () => {
    const results = await Promise.all(
      createHistorySources().map((source) => source.scan(paths)),
    );
    const documents = results.flatMap((result) => result.documents);
    const grok = documents.find((document) => document.source === "grok");
    expect(grok?.toolOutputText).toContain("run shell command");
    expect(grok?.toolOutputText).toContain("completed");
    expect(grok?.toolOutputText).not.toContain("grok-tool-command-marker");
    expect(grok?.toolOutputText).not.toContain("sk-should-not-appear-in-index");
    expect(grok?.toolOutputText).not.toContain(
      "test-bearer-token-fixture-marker",
    );
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

describe("rejects malformed usage data instead of understating it", () => {
  test("rejects a Grok turn_completed record with a malformed model-usage entry", async () => {
    const result = await scanGrokTurnCompletedFixture(
      "grok-malformed",
      "grok-malformed-session",
      { modelUsage: { "grok-4.5-build": "not-an-object" } },
    );
    expect(result?.available).toBe(false);
    expect(result?.error).toContain("Malformed Grok model usage entry");
  });

  test("rejects a nonnumeric Grok usage field instead of silently zeroing it", async () => {
    const result = await scanGrokTurnCompletedFixture(
      "grok-nonnumeric-usage",
      "grok-nonnumeric-session",
      { inputTokens: "100", outputTokens: 20 },
    );
    expect(result?.available).toBe(false);
    expect(result?.error).toContain('Malformed Grok usage field "inputTokens"');
  });

  test("rejects an explicit null Grok usage field the same as a nonnumeric one", async () => {
    const result = await scanGrokTurnCompletedFixture(
      "grok-null-usage",
      "grok-null-session",
      { inputTokens: null, outputTokens: 20 },
    );
    expect(result?.available).toBe(false);
    expect(result?.error).toContain('Malformed Grok usage field "inputTokens"');
  });

  test("rejects a malformed Claude usage count instead of silently zeroing it", async () => {
    const claudeProjects = path.join(fixtureRoot, "claude-malformed-usage");
    await mkdir(claudeProjects, { recursive: true });
    await Bun.write(
      path.join(claudeProjects, "session.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        sessionId: "claude-malformed-session",
        timestamp: "2026-08-12T00:00:00Z",
        message: {
          id: "msg_malformed",
          role: "assistant",
          model: "claude-sonnet-5",
          usage: { input_tokens: "1000", output_tokens: 50 },
          content: [{ type: "text", text: "reply" }],
        },
      })}\n`,
    );
    const source = createHistorySources().find(
      (entry) => entry.name === "claude",
    );
    expect(source).toBeDefined();
    const result = await source?.scan({ ...paths, claudeProjects });
    expect(result?.available).toBe(false);
    expect(result?.error).toContain(
      'Malformed Claude usage field "input_tokens"',
    );
  });

  test("rejects a malformed Codex usage count instead of silently zeroing it", async () => {
    const codexSessionsDir = path.join(
      fixtureRoot,
      "codex-malformed-usage-sessions",
    );
    await mkdir(codexSessionsDir, { recursive: true });
    await Bun.write(
      path.join(codexSessionsDir, "rollout-malformed.jsonl"),
      `${[
        {
          timestamp: "2026-08-08T00:00:00.000Z",
          type: "session_meta",
          payload: { session_id: "t-malformed", id: "t-malformed" },
        },
        {
          timestamp: "2026-08-08T00:00:01.000Z",
          type: "token_usage_record",
          payload: { turn_token_usage: { input_tokens: "1000" } },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`,
    );
    const source = createHistorySources().find(
      (entry) => entry.name === "codex",
    );
    expect(source).toBeDefined();
    const result = await source?.scan({ ...paths, codexSessionsDir });
    expect(result?.available).toBe(false);
    expect(result?.error).toContain(
      'Malformed Codex usage field "input_tokens"',
    );
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
