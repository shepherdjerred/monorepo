import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HistoryPaths } from "#lib/history/paths.ts";
import { kimiModelCandidates } from "#lib/history/sources/kimi.ts";
import type {
  HistoryDocument,
  HistoryRecord,
  HistorySource,
} from "#lib/history/types.ts";
import {
  KIMI_CREATED_MS,
  KIMI_SESSION_ID,
  KIMI_UPDATED_MS,
  KIMI_WORKDIR,
  kimiMainWire,
  writeKimiFixture,
} from "./history-fixtures/kimi.ts";
import {
  MUSE_CREATED_US,
  MUSE_SESSION_ID,
  MUSE_SUBAGENT_ID,
  MUSE_UPDATED_US,
  museRootLog,
  museUsage,
  setMuseTitle,
  writeMuseFixture,
} from "./history-fixtures/muse.ts";

import {
  historyPathsUnder,
  historySourceNamed,
} from "./history-fixtures/sources.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "history-kimi-muse-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function source(name: "kimi" | "muse"): HistorySource {
  return historySourceNamed(name);
}

function pathsFor(overrides: Partial<HistoryPaths>): HistoryPaths {
  return historyPathsUnder(root, overrides);
}

async function scanDocuments(
  name: "kimi" | "muse",
  paths: HistoryPaths,
): Promise<readonly HistoryDocument[]> {
  const result = await source(name).scan(paths);
  expect(result.error).toBeNull();
  expect(result.available).toBe(true);
  return result.documents;
}

function byId(
  documents: readonly HistoryDocument[],
  sourceId: string,
): HistoryDocument {
  const document = documents.find((entry) => entry.sourceId === sourceId);
  if (document === undefined) {
    throw new Error(`missing document ${sourceId}`);
  }
  return document;
}

function recordsOf(documents: readonly HistoryDocument[]): HistoryRecord[] {
  return documents.map((document, index) => ({
    ...document,
    id: index + 1,
    excerpt: null,
  }));
}

const KIMI_MAIN = path.join(
  KIMI_WORKDIR,
  KIMI_SESSION_ID,
  "agents/main/wire.jsonl",
);
const KIMI_SUB = path.join(
  KIMI_WORKDIR,
  KIMI_SESSION_ID,
  "agents/sub-1/wire.jsonl",
);

describe("kimi source", () => {
  test("indexes one document per agent wire log with state.json metadata", async () => {
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-meta"),
    );
    const documents = await scanDocuments(
      "kimi",
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(documents.map((document) => document.sourceId).sort()).toEqual(
      [KIMI_MAIN, KIMI_SUB].sort(),
    );
    const main = byId(documents, KIMI_MAIN);
    expect(main).toMatchObject({
      source: "kimi",
      title: "Kimi fixture title",
      workspace: "/Users/example/project",
      gitBranch: null,
      agent: "Kimi Code",
      runtimeId: KIMI_SESSION_ID,
      createdAt: new Date(KIMI_CREATED_MS).toISOString(),
      updatedAt: new Date(KIMI_UPDATED_MS).toISOString(),
    });
    const sub = byId(documents, KIMI_SUB);
    expect(sub.title).toBe("[coder subagent] Kimi fixture title");
    expect(sub.workspace).toBe("/Users/example/project");
    expect(sub.dialogueText).toContain("kimi-subagent-marker");
    expect(sub.usageEvents).toHaveLength(1);
  });

  test("counts each model call once from usage.record turn scope only", async () => {
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-usage"),
    );
    const documents = await scanDocuments(
      "kimi",
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    const main = byId(documents, KIMI_MAIN);
    // step.end and message meta repeat the first record's usage; the
    // session-scoped record is cumulative. Only the two turn records count.
    expect(main.usageEvents).toHaveLength(2);
    expect(main.usageEvents[0]).toMatchObject({
      model: "kimi-code/k3.1-pro",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 5000,
      cacheCreationTokens: 300,
      cachedInputTokens: 0,
      costComplete: true,
    });
    // Priced as kimi-k3.1-pro: 1,000 input at $2, 5,000 cache reads at
    // $0.20, 300 cache writes at $2, and 200 output at $10, per 1M.
    expect(main.usageEvents[0]?.costUsd).toBeCloseTo(5600e-6, 12);
    expect(main.usageEvents.map((event) => event.occurredAt)).toEqual([
      new Date(KIMI_CREATED_MS + 1008).toISOString(),
      new Date(KIMI_CREATED_MS + 1014).toISOString(),
    ]);
  });

  test("indexes prompts, user steers, replies, tool calls, and tool output", async () => {
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-text"),
    );
    const paths = pathsFor({ kimiSessionsDir: sessionsDir });
    const documents = await scanDocuments("kimi", paths);
    const main = byId(documents, KIMI_MAIN);
    expect(main.dialogueText).toContain("kimi-prompt-marker");
    expect(main.dialogueText).toContain("kimi-reply-marker");
    expect(main.dialogueText).toContain("kimi-steer-marker");
    expect(main.dialogueText).not.toContain("kimi-think-marker");
    expect(main.dialogueText).not.toContain("kimi-skill-marker");
    expect(main.toolOutputText).toContain("kimi-output-marker");
    expect(main.toolOutputText).toContain("kimi-array-output");
    expect(main.toolOutputText).toContain("kimi-arg-marker");
    expect(main.toolOutputText).not.toContain("base64");
    expect(main.toolCalls).toEqual([
      {
        name: "Bash",
        occurredAt: new Date(KIMI_CREATED_MS + 1005).toISOString(),
      },
      {
        name: "ReadMediaFile",
        occurredAt: new Date(KIMI_CREATED_MS + 1012).toISOString(),
      },
    ]);

    const read = await source("kimi").read(paths, recordsOf([main]));
    expect(read.error).toBeNull();
    const messages = read.messages.get(KIMI_MAIN) ?? [];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
      "tool",
      "tool",
    ]);
    expect(
      messages.filter((message) => message.toolName !== undefined),
    ).toHaveLength(2);
  });

  test("an absent root is unavailable, not an error", async () => {
    const result = await source("kimi").scan(
      pathsFor({ kimiSessionsDir: path.join(root, "kimi-absent") }),
    );
    expect(result).toMatchObject({
      available: false,
      error: null,
      documents: [],
    });
  });

  test("a session without state.json fails the scan", async () => {
    const { sessionDir, sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-no-state"),
    );
    await rm(path.join(sessionDir, "state.json"));
    const result = await source("kimi").scan(
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(result.available).toBe(false);
    expect(result.error).toContain("missing its state.json");
  });

  test("a usage record without a scope fails the scan", async () => {
    const wire = kimiMainWire().map((record) =>
      record["type"] === "usage.record"
        ? { ...record, usageScope: undefined }
        : record,
    );
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-no-scope"),
      wire,
    );
    const result = await source("kimi").scan(
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(result.error).toContain("missing its usageScope");
  });

  test("a truncated wire line fails the scan", async () => {
    const { sessionDir, sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-truncated"),
    );
    await writeFile(
      path.join(sessionDir, "agents/sub-1/wire.jsonl"),
      '{"type":"usage.record"\n',
    );
    const result = await source("kimi").scan(
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(result.error).toContain("Malformed Kimi transcript line 1");
  });

  test("model candidates map the Kimi Code alias to the API model id", () => {
    expect(kimiModelCandidates("kimi-code/k3.1-pro")).toEqual([
      "kimi-code/k3.1-pro",
      "kimi-k3.1-pro",
    ]);
    expect(kimiModelCandidates("kimi-k3")).toEqual(["kimi-k3"]);
  });

  test("a model the catalog does not price keeps its tokens and no cost", async () => {
    const wire = kimiMainWire().map((record) =>
      record["type"] === "usage.record"
        ? { ...record, model: "kimi-code/k9-unlisted" }
        : record,
    );
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-unpriced"),
      wire,
    );
    const documents = await scanDocuments(
      "kimi",
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(byId(documents, KIMI_MAIN).usageEvents[0]).toMatchObject({
      inputTokens: 1000,
      costUsd: null,
      costComplete: false,
    });
  });
});

const MUSE_ROOT_ID = path.join(
  "sessions/2026/11/11",
  MUSE_SESSION_ID,
  "session.jsonl",
);
const MUSE_SUB_ID = path.join(
  "sessions/2026/11/11",
  MUSE_SESSION_ID,
  "subagent",
  MUSE_SUBAGENT_ID,
  "session.jsonl",
);

describe("muse source", () => {
  test("indexes root sessions from session-index.db and subagent logs beside them", async () => {
    const { museRoot } = await writeMuseFixture(path.join(root, "muse-meta"));
    const documents = await scanDocuments("muse", pathsFor({ museRoot }));
    expect(documents.map((document) => document.sourceId).sort()).toEqual(
      [MUSE_ROOT_ID, MUSE_SUB_ID].sort(),
    );
    const main = byId(documents, MUSE_ROOT_ID);
    expect(main).toMatchObject({
      source: "muse",
      title: "Muse fixture title",
      workspace: "/Users/example/project",
      // The index's branch wins over the log's own observation.
      gitBranch: "muse-index-branch",
      agent: "Meta Muse",
      runtimeId: MUSE_SESSION_ID,
      createdAt: new Date(MUSE_CREATED_US / 1000).toISOString(),
      updatedAt: new Date(MUSE_UPDATED_US / 1000).toISOString(),
    });
    const sub = byId(documents, MUSE_SUB_ID);
    expect(sub.title).toBe(
      "[subagent of Muse fixture title] Recall muse-subagent-marker",
    );
    // A memory-reminder child has no workspace of its own.
    expect(sub.workspace).toBe("/Users/example/project");
    expect(sub.gitBranch).toBe("muse-index-branch");
    expect(sub.runtimeId).toBe(MUSE_SUBAGENT_ID);
  });

  test("maps model_completed usage with cache reads as a subset of input", async () => {
    const { museRoot } = await writeMuseFixture(path.join(root, "muse-usage"));
    const documents = await scanDocuments("muse", pathsFor({ museRoot }));
    const main = byId(documents, MUSE_ROOT_ID);
    // subagent.control.runtime_observed is not counted on the parent.
    expect(main.usageEvents).toHaveLength(1);
    expect(main.usageEvents[0]).toMatchObject({
      model: "muse-wonder-1.0",
      inputTokens: 10_000,
      outputTokens: 300,
      cachedInputTokens: 8000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 100,
      costUsd: null,
      costComplete: false,
    });
    expect(byId(documents, MUSE_SUB_ID).usageEvents).toMatchObject([
      { model: "muse-spark-1.3", inputTokens: 40, outputTokens: 4 },
    ]);
  });

  test("skips retention markers and indexes dialogue and tools", async () => {
    const { museRoot } = await writeMuseFixture(path.join(root, "muse-text"));
    const paths = pathsFor({ museRoot });
    const documents = await scanDocuments("muse", paths);
    const main = byId(documents, MUSE_ROOT_ID);
    expect(main.dialogueText).toContain("muse-prompt-marker");
    expect(main.dialogueText).toContain("muse-reply-marker");
    expect(main.dialogueText).not.toContain("muse-context-marker");
    expect(main.toolOutputText).toContain("muse-output-marker");
    expect(main.toolOutputText).toContain("muse-arg-marker");
    expect(main.toolCalls).toEqual([
      {
        name: "read_file",
        occurredAt: new Date(
          (MUSE_CREATED_US + 1_000_008) / 1000,
        ).toISOString(),
      },
    ]);
    expect(main.messageCount).toBe(4);

    const read = await source("muse").read(paths, recordsOf(documents));
    expect(read.error).toBeNull();
    expect(
      read.messages.get(MUSE_ROOT_ID)?.map((message) => message.role),
    ).toEqual(["user", "tool", "tool", "assistant"]);
    expect(read.messages.get(MUSE_SUB_ID)).toHaveLength(1);
  });

  test("rescans only what changed, and a retitle re-parses the session and its subagents", async () => {
    const { museRoot, dbPath } = await writeMuseFixture(
      path.join(root, "muse-incremental"),
    );
    const paths = pathsFor({ museRoot });
    const muse = source("muse");
    const first = await muse.scan(paths);
    expect(first.documents).toHaveLength(2);
    muse.commitScan?.();
    const unchanged = await muse.scan(paths);
    expect(unchanged.documents).toHaveLength(0);
    expect(unchanged.complete).toBe(false);
    expect(unchanged.sourceIds).toHaveLength(2);
    muse.commitScan?.();
    setMuseTitle(dbPath, "Renamed muse session");
    const retitled = await muse.scan(paths);
    expect(retitled.documents.map((document) => document.title).sort()).toEqual(
      [
        "Renamed muse session",
        "[subagent of Renamed muse session] Recall muse-subagent-marker",
      ],
    );
  });

  test("an absent root is unavailable, not an error", async () => {
    const result = await source("muse").scan(
      pathsFor({ museRoot: path.join(root, "muse-absent") }),
    );
    expect(result).toMatchObject({
      available: false,
      error: null,
      documents: [],
    });
  });

  test("an index row whose log is missing fails the scan", async () => {
    const { museRoot, sessionDir } = await writeMuseFixture(
      path.join(root, "muse-missing-log"),
    );
    await rm(path.join(sessionDir, "session.jsonl"));
    const result = await source("muse").scan(pathsFor({ museRoot }));
    expect(result.available).toBe(false);
    expect(result.error).toContain("Muse session log is missing");
  });

  test("cache-write tokens of unverified convention fail the scan", async () => {
    const { museRoot } = await writeMuseFixture(
      path.join(root, "muse-cache-write"),
      museRootLog(museUsage({ cache_write_tokens: 10 })),
    );
    const result = await source("muse").scan(pathsFor({ museRoot }));
    expect(result.error).toContain("cache-write tokens");
  });

  test("an envelope without a payload type fails the scan", async () => {
    const { museRoot } = await writeMuseFixture(
      path.join(root, "muse-envelope"),
      [...museRootLog(), { schema_version: 1, recorded_at: MUSE_CREATED_US }],
    );
    const result = await source("muse").scan(pathsFor({ museRoot }));
    expect(result.error).toContain("Malformed Muse event envelope");
  });
});
