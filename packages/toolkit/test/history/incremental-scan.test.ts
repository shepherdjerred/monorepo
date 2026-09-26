import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryRuntimePaths,
  type HistoryPaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import type { HistorySource } from "#lib/history/types.ts";
import { writeAntigravityFixture } from "./history-fixtures/antigravity.ts";
import { writeClaudeFixture } from "./history-fixtures/claude.ts";
import {
  writeCodexFixture,
  writeCodexSessionUsageFixture,
} from "./history-fixtures/codex.ts";
import { writeGrokFixture } from "./history-fixtures/grok.ts";

let fixtureRoot = "";
let paths: HistoryPaths = {
  home: "",
  conductorDb: "",
  conductorOpenCodeDb: "",
  claudeProjects: "",
  codexDir: "",
  codexCatalogDb: "",
  codexHistoryJsonl: "",
  cursorConversationDb: "",
  standaloneOpenCodeDb: "",
  standaloneOpenCodeAuth: "",
  antigravityRoots: [],
  grokHome: "",
  codexSessionsDir: "",
};
let codexThreadDb = "";
let codexSessionsDir = "";

function source(name: string): HistorySource {
  const found = createHistorySources().find((entry) => entry.name === name);
  expect(found).toBeDefined();
  if (found === undefined) {
    throw new Error(`History source ${name} was not registered`);
  }
  return found;
}

async function writeClaudeSession(
  file: string,
  sessionId: string,
  prompt: string,
): Promise<void> {
  const user = {
    type: "user",
    sessionId,
    timestamp: "2026-08-12T00:00:00Z",
    message: { role: "user", content: prompt },
  };
  const assistant = {
    type: "assistant",
    sessionId,
    timestamp: "2026-08-12T00:01:00Z",
    message: {
      id: `msg_${sessionId}`,
      role: "assistant",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: "text", text: "done" }],
    },
  };
  await Bun.write(
    file,
    `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`,
  );
}

function dumpIndex(indexDb: string): {
  readonly documents: readonly unknown[];
  readonly usage: readonly unknown[];
  readonly fts: readonly unknown[];
  readonly state: readonly unknown[];
} {
  const database = new Database(indexDb, { readonly: true });
  try {
    const documents = database
      .query(
        `SELECT source, source_id, title, path, workspace, agent, created_at,
                updated_at, runtime_id, opening_prompt_hash, content_hash
           FROM documents ORDER BY source, source_id`,
      )
      .all();
    const usage = database
      .query(
        `SELECT d.source, d.source_id, u.occurred_at, u.model, u.input_tokens,
                u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens,
                u.cached_input_tokens, u.reasoning_tokens, u.cost_usd,
                u.cost_complete
           FROM usage_events u JOIN documents d ON d.id = u.document_id
          ORDER BY d.source, d.source_id, u.occurred_at, u.model,
                   u.input_tokens, u.output_tokens`,
      )
      .all();
    const fts = database
      .query(
        `SELECT d.source, d.source_id, f.title, f.dialogue, f.tool_output
           FROM history_fts f JOIN documents d ON d.id = f.rowid
          ORDER BY d.source, d.source_id`,
      )
      .all();
    const state = database
      .query(
        `SELECT source, available, indexed_documents, fingerprint, error
           FROM source_state ORDER BY source`,
      )
      .all();
    return { documents, usage, fts, state };
  } finally {
    database.close();
  }
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-incr-"));
  const claudeDir = path.join(fixtureRoot, "claude/projects/project");
  const codexDir = path.join(fixtureRoot, "codex");
  codexSessionsDir = path.join(fixtureRoot, "codex-sessions");
  const grokHome = path.join(fixtureRoot, "grok");
  const antigravityRoot = path.join(fixtureRoot, "antigravity");
  await Promise.all([
    mkdir(claudeDir, { recursive: true }),
    mkdir(codexDir, { recursive: true }),
    mkdir(codexSessionsDir, { recursive: true }),
  ]);
  await writeClaudeFixture(claudeDir);
  const codex = await writeCodexFixture(codexDir);
  codexThreadDb = codex.codexThread;
  await writeCodexSessionUsageFixture(codexSessionsDir);
  await writeGrokFixture(grokHome);
  await writeAntigravityFixture(antigravityRoot);
  paths = {
    ...paths,
    home: fixtureRoot,
    claudeProjects: path.join(fixtureRoot, "claude/projects"),
    codexDir,
    codexCatalogDb: codex.codexCatalog,
    codexHistoryJsonl: codex.codexHistory,
    grokHome,
    antigravityRoots: [antigravityRoot],
    codexSessionsDir,
  };
});

afterAll(async () => {
  if (fixtureRoot.length > 0) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe("incremental claude scans", () => {
  test("claude rescan without changes returns no documents", async () => {
    const claude = source("claude");
    const first = await claude.scan(paths);
    expect(first.error).toBeNull();
    expect(first.complete).toBe(true);
    expect(first.documents.length).toBeGreaterThan(0);
    expect([...first.sourceIds].sort()).toEqual(
      first.documents.map((document) => document.sourceId).sort(),
    );

    const second = await claude.scan(paths);
    expect(second.error).toBeNull();
    expect(second.available).toBe(true);
    expect(second.complete).toBe(false);
    expect(second.documents).toEqual([]);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect([...second.sourceIds].sort()).toEqual([...first.sourceIds].sort());
  });

  test("claude rescan does not read unchanged files", async () => {
    const claude = source("claude");
    const first = await claude.scan(paths);
    expect(first.error).toBeNull();
    const projects = paths.claudeProjects;
    const file = path.join(projects, "project/session.jsonl");
    await chmod(file, 0o000);
    try {
      const second = await claude.scan(paths);
      expect(second.error).toBeNull();
      expect(second.complete).toBe(false);
      expect(second.documents).toEqual([]);
    } finally {
      await chmod(file, 0o600);
    }
  });

  test("claude re-parses only the changed file", async () => {
    const dir = path.join(fixtureRoot, "claude-reparse/projects/project");
    await mkdir(dir, { recursive: true });
    await writeClaudeSession(path.join(dir, "a.jsonl"), "s-a", "alpha prompt");
    await writeClaudeSession(path.join(dir, "b.jsonl"), "s-b", "beta prompt");
    const scoped = {
      ...paths,
      claudeProjects: path.join(fixtureRoot, "claude-reparse/projects"),
    };
    const claude = source("claude");
    const first = await claude.scan(scoped);
    expect(first.documents).toHaveLength(2);

    await Bun.write(
      path.join(dir, "b.jsonl"),
      `${JSON.stringify({
        type: "user",
        sessionId: "s-b",
        timestamp: "2026-08-12T00:02:00Z",
        message: { role: "user", content: "beta follow-up with more text" },
      })}\n`,
    );

    const second = await claude.scan(scoped);
    expect(second.error).toBeNull();
    expect(second.complete).toBe(false);
    expect(second.documents.map((document) => document.sourceId)).toEqual([
      "project/b.jsonl",
    ]);
    expect(second.documents[0]?.dialogueText).toContain("beta follow-up");
    expect([...second.sourceIds].sort()).toEqual([
      "project/a.jsonl",
      "project/b.jsonl",
    ]);
  });

  test("claude force scan returns the complete set", async () => {
    const claude = source("claude");
    await claude.scan(paths);
    const forced = await claude.scan(paths, { force: true });
    expect(forced.error).toBeNull();
    expect(forced.complete).toBe(true);
    expect(forced.documents.length).toBeGreaterThan(0);
    expect([...forced.sourceIds].sort()).toEqual(
      forced.documents.map((document) => document.sourceId).sort(),
    );
  });
});

describe("incremental codex scans", () => {
  test("codex rescan without changes returns no documents", async () => {
    const codex = source("codex");
    const first = await codex.scan(paths);
    expect(first.error).toBeNull();
    expect(first.complete).toBe(true);
    expect(first.documents.length).toBeGreaterThan(0);

    const second = await codex.scan(paths);
    expect(second.error).toBeNull();
    expect(second.complete).toBe(false);
    expect(second.documents).toEqual([]);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect([...second.sourceIds].sort()).toEqual([...first.sourceIds].sort());
  });

  test("codex re-derives only the thread whose session changed", async () => {
    const codex = source("codex");
    const first = await codex.scan(paths);
    expect(first.error).toBeNull();
    const before = first.documents.find(
      (document) => document.sourceId === `${codexThreadDb}:t1`,
    );
    expect(before).toBeDefined();

    const rollout = path.join(codexSessionsDir, "rollout-t1.jsonl");
    const extra = {
      timestamp: "2026-08-08T00:00:09.000Z",
      ordinal: 9,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 777,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 88,
          reasoning_output_tokens: 0,
          total_tokens: 865,
        },
      },
    };
    const previous = await Bun.file(rollout).text();
    await Bun.write(rollout, `${previous}${JSON.stringify(extra)}\n`);

    const second = await codex.scan(paths);
    expect(second.error).toBeNull();
    expect(second.complete).toBe(false);
    expect(second.documents.map((document) => document.sourceId)).toEqual([
      `${codexThreadDb}:t1`,
    ]);
    const updated = second.documents[0];
    expect(updated?.usageEvents).toHaveLength(
      (before?.usageEvents.length ?? 0) + 1,
    );
    expect(
      updated?.usageEvents.some((event) => event.inputTokens === 777),
    ).toBe(true);
    expect([...second.sourceIds].sort()).toEqual([...first.sourceIds].sort());
  });
});

describe("incremental grok and antigravity scans", () => {
  test("grok and antigravity rescans without changes return no documents", async () => {
    for (const name of ["grok", "antigravity"] as const) {
      const adapter = source(name);
      const first = await adapter.scan(paths);
      expect(first.error).toBeNull();
      expect(first.complete).toBe(true);
      const second = await adapter.scan(paths);
      expect(second.error).toBeNull();
      expect(second.complete).toBe(false);
      expect(second.documents).toEqual([]);
      expect(second.fingerprint).toBe(first.fingerprint);
    }
  });
});

describe("incremental ingest convergence", () => {
  test("incremental ingest converges with a full rebuild", async () => {
    const dir = path.join(fixtureRoot, "converge");
    const claudeDir = path.join(dir, "claude/projects/project");
    const convergeCodexDir = path.join(dir, "codex");
    const convergeSessionsDir = path.join(dir, "codex-sessions");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(convergeCodexDir, { recursive: true });
    await mkdir(convergeSessionsDir, { recursive: true });
    await writeClaudeSession(
      path.join(claudeDir, "keep.jsonl"),
      "keep",
      "keep prompt",
    );
    await writeClaudeSession(
      path.join(claudeDir, "drop.jsonl"),
      "drop",
      "drop prompt",
    );
    const codex = await writeCodexFixture(convergeCodexDir);
    await writeCodexSessionUsageFixture(convergeSessionsDir);
    const scoped: HistoryPaths = {
      ...paths,
      claudeProjects: path.join(dir, "claude/projects"),
      codexDir: convergeCodexDir,
      codexCatalogDb: codex.codexCatalog,
      codexHistoryJsonl: codex.codexHistory,
      codexSessionsDir: convergeSessionsDir,
    };

    const claude = source("claude");
    const codexSource = source("codex");
    const incrementalRuntime = defaultHistoryRuntimePaths(
      path.join(dir, "index-incremental"),
    );
    const incremental = await HistoryIndex.open(incrementalRuntime);
    await incremental.ingest([
      await claude.scan(scoped),
      await codexSource.scan(scoped),
    ]);

    // Mutate in two steps: first without deletions (incremental), then
    // with a deletion (full re-parse fallback).
    await Bun.write(
      path.join(claudeDir, "keep.jsonl"),
      `${JSON.stringify({
        type: "user",
        sessionId: "keep",
        timestamp: "2026-08-12T00:03:00Z",
        message: { role: "user", content: "keep follow-up change" },
      })}\n`,
    );
    const rollout = path.join(convergeSessionsDir, "rollout-t1.jsonl");
    const rolloutPrevious = await Bun.file(rollout).text();
    await Bun.write(
      rollout,
      `${rolloutPrevious}${JSON.stringify({
        timestamp: "2026-08-08T00:00:07.000Z",
        ordinal: 7,
        type: "token_usage_record",
        payload: {
          turn_token_usage: {
            input_tokens: 5,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 6,
            reasoning_output_tokens: 0,
            total_tokens: 11,
          },
        },
      })}\n`,
    );
    await Bun.write(
      path.join(convergeSessionsDir, "rollout-new-thread.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-08-11T00:00:00.000Z",
        ordinal: 0,
        type: "session_meta",
        payload: { session_id: "t-brand-new", id: "t-brand-new" },
      })}\n${JSON.stringify({
        timestamp: "2026-08-11T00:00:01.000Z",
        ordinal: 1,
        type: "event_msg",
        payload: {
          type: "thread_settings_applied",
          thread_settings: { model: "gpt-5.6-sol" },
        },
      })}\n${JSON.stringify({
        timestamp: "2026-08-11T00:00:02.000Z",
        ordinal: 2,
        type: "token_usage_record",
        payload: {
          turn_token_usage: {
            input_tokens: 11,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 12,
            reasoning_output_tokens: 0,
            total_tokens: 23,
          },
        },
      })}\n`,
    );
    const threadDb = new Database(codex.codexThread);
    try {
      threadDb.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'extra', 4, 1786406403000, '{\"type\":\"userMessage\",\"text\":\"Follow-up question\"}', 'userMessage', 0)",
      );
    } finally {
      threadDb.close();
    }

    const claudeSecond = await claude.scan(scoped);
    const codexSecond = await codexSource.scan(scoped);
    expect(claudeSecond.complete).toBe(false);
    expect(codexSecond.complete).toBe(false);
    await incremental.ingest([claudeSecond, codexSecond]);

    await rm(path.join(claudeDir, "drop.jsonl"));
    const claudeThird = await claude.scan(scoped);
    expect(claudeThird.complete).toBe(true);
    expect(claudeThird.sourceIds).not.toContain("project/drop.jsonl");
    await incremental.ingest([claudeThird]);
    incremental.close();

    const rebuiltRuntime = defaultHistoryRuntimePaths(
      path.join(dir, "index-rebuilt"),
    );
    const rebuilt = await HistoryIndex.open(rebuiltRuntime);
    const freshClaude = source("claude");
    const freshCodex = source("codex");
    await rebuilt.ingest([
      await freshClaude.scan(scoped),
      await freshCodex.scan(scoped),
    ]);
    rebuilt.close();

    expect(dumpIndex(incrementalRuntime.indexDb)).toEqual(
      dumpIndex(rebuiltRuntime.indexDb),
    );
  });
});
