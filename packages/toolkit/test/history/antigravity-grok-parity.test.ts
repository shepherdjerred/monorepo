import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HistoryPaths } from "#lib/history/paths.ts";
import type {
  HistoryDocument,
  HistoryRecord,
  HistorySource,
} from "#lib/history/types.ts";
import { writeAntigravityFixture } from "./history-fixtures/antigravity.ts";
import { writeDatabase } from "./history-fixtures/database.ts";

import {
  historyPathsUnder,
  historySourceNamed,
} from "./history-fixtures/sources.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "history-parity-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function source(name: "antigravity" | "grok"): HistorySource {
  return historySourceNamed(name);
}

function pathsFor(overrides: Partial<HistoryPaths>): HistoryPaths {
  return historyPathsUnder(root, overrides);
}

async function scanDocuments(
  name: "antigravity" | "grok",
  paths: HistoryPaths,
): Promise<readonly HistoryDocument[]> {
  const result = await source(name).scan(paths);
  expect(result.error).toBeNull();
  return result.documents;
}

const CONVERSATION = "antigravity-session-1";

function recordOf(document: HistoryDocument | undefined): HistoryRecord[] {
  return document === undefined ? [] : [{ ...document, id: 1, excerpt: null }];
}

function transcriptLine(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

async function writeTranscript(
  antigravityRoot: string,
  lines: readonly string[],
): Promise<void> {
  const dir = path.join(
    antigravityRoot,
    "brain",
    CONVERSATION,
    ".system_generated",
    "logs",
  );
  await mkdir(dir, { recursive: true });
  await Bun.write(path.join(dir, "transcript_full.jsonl"), lines.join("\n"));
}

describe("antigravity transcripts", () => {
  test("keeps usage-only behaviour when the brain transcript is missing", async () => {
    const antigravityRoot = path.join(root, "ag-missing");
    await writeAntigravityFixture(antigravityRoot);
    const [document] = await scanDocuments(
      "antigravity",
      pathsFor({ antigravityRoots: [antigravityRoot] }),
    );
    expect(document?.workspace).toBeNull();
    expect(document?.messageCount).toBe(0);
    expect(document?.dialogueText).toBe("");
    expect(document?.usageEvents.length).toBeGreaterThan(0);
    const read = await source("antigravity").read(
      pathsFor({ antigravityRoots: [antigravityRoot] }),
      recordOf(document),
    );
    expect(read.messages.get(document?.sourceId ?? "")?.[0]?.role).toBe(
      "unknown",
    );
  });

  test("indexes transcript messages and tool calls, workspace and title, without touching usage", async () => {
    const antigravityRoot = path.join(root, "ag-full");
    await writeAntigravityFixture(antigravityRoot);
    const baseline = await scanDocuments(
      "antigravity",
      pathsFor({ antigravityRoots: [antigravityRoot] }),
    );
    await writeTranscript(antigravityRoot, [
      transcriptLine({
        step_index: 0,
        type: "USER_INPUT",
        source: "USER",
        status: "DONE",
        created_at: "2026-08-10T12:00:00Z",
        content: "please fix the widget parity-user-marker",
      }),
      transcriptLine({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        created_at: "2026-08-10T12:00:05Z",
        content: "on it parity-assistant-marker",
        thinking: "parity-thinking-marker",
        tool_calls: [{ name: "view_file", args: { path: "/x/secret" } }],
        input_tokens: 999_999,
        output_tokens: 999_999,
        cache_read_tokens: 999_999,
      }),
      transcriptLine({
        step_index: 2,
        type: "GENERIC",
        created_at: "2026-08-10T12:00:06Z",
        content: "parity-tool-output-marker",
      }),
      transcriptLine({
        step_index: 3,
        type: "SYSTEM_MESSAGE",
        content: "parity-system-marker",
      }),
      transcriptLine({
        step_index: 4,
        type: "CHECKPOINT",
        content: "parity-checkpoint-marker",
      }),
    ]);
    writeDatabase(
      path.join(antigravityRoot, "conversation_summaries.db"),
      "CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT '', workspace_uris text NOT NULL);",
      (database) => {
        database
          .prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?)")
          .run(
            CONVERSATION,
            "Widget parity session",
            JSON.stringify(["file:///work/with%20space/repo", "file:///other"]),
          );
      },
    );
    const paths = pathsFor({ antigravityRoots: [antigravityRoot] });
    const [document] = await scanDocuments("antigravity", paths);
    expect(document?.workspace).toBe("/work/with space/repo");
    expect(document?.title).toBe("Widget parity session");
    expect(document?.messageCount).toBe(4);
    expect(document?.toolCalls.map((call) => call.name)).toEqual(["view_file"]);
    expect(document?.dialogueText).toContain("parity-user-marker");
    expect(document?.dialogueText).toContain("parity-assistant-marker");
    expect(document?.dialogueText).not.toContain("parity-thinking-marker");
    expect(document?.dialogueText).not.toContain("parity-system-marker");
    expect(document?.toolOutputText).toContain("parity-tool-output-marker");
    expect(document?.toolOutputText).not.toContain("/x/secret");
    expect(document?.usageEvents).toEqual(baseline[0]?.usageEvents);

    const read = await source("antigravity").read(paths, recordOf(document));
    const messages = read.messages.get(document?.sourceId ?? "") ?? [];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(messages[0]?.createdAt).toBe("2026-08-10T12:00:00.000Z");
  });

  test("fails the scan on a malformed transcript line", async () => {
    const antigravityRoot = path.join(root, "ag-malformed");
    await writeAntigravityFixture(antigravityRoot);
    await writeTranscript(antigravityRoot, ["{not json"]);
    const result = await source("antigravity").scan(
      pathsFor({ antigravityRoots: [antigravityRoot] }),
    );
    expect(result.error).toContain("Malformed Antigravity transcript line 1");
  });
});

async function writeGrokSession(
  name: string,
  summary: Record<string, unknown> | null,
  usage: Record<string, unknown>,
): Promise<string> {
  const grokHome = path.join(root, name);
  const sessionDir = path.join(grokHome, "sessions", "%2Ftest%2Fp", "s1");
  await mkdir(sessionDir, { recursive: true });
  if (summary !== null) {
    await Bun.write(
      path.join(sessionDir, "summary.json"),
      JSON.stringify(summary),
    );
  }
  await Bun.write(
    path.join(sessionDir, "updates.jsonl"),
    `${JSON.stringify({
      timestamp: 1_788_721_656,
      params: { update: { sessionUpdate: "turn_completed", usage } },
    })}\n`,
  );
  return grokHome;
}

describe("grok parity", () => {
  test("reads head_branch into the document", async () => {
    const grokHome = await writeGrokSession(
      "grok-branch",
      { info: { id: "s1", cwd: "/test/p" }, head_branch: "feature/parity" },
      { inputTokens: 1, outputTokens: 1, costUsdTicks: 10_000_000 },
    );
    const [document] = await scanDocuments("grok", pathsFor({ grokHome }));
    expect(document?.gitBranch).toBe("feature/parity");
  });

  test("uses the reported cost when the turn has ticks", async () => {
    const grokHome = await writeGrokSession("grok-ticks", null, {
      inputTokens: 1000,
      outputTokens: 200,
      cachedReadTokens: 400,
      costUsdTicks: 50_000_000,
      modelUsage: {
        "gpt-6-luna-build": {
          inputTokens: 1000,
          outputTokens: 200,
          cachedReadTokens: 400,
          costUsdTicks: 50_000_000,
        },
      },
    });
    const [document] = await scanDocuments("grok", pathsFor({ grokHome }));
    expect(document?.usageEvents[0]?.costUsd).toBeCloseTo(0.005, 10);
    expect(document?.usageEvents[0]?.costComplete).toBe(true);
  });

  test("prices a turn without ticks from the catalog, stripping -build and provider prefixes", async () => {
    for (const model of [
      "gpt-6-luna-build",
      "xai/gpt-6-luna",
      "x-ai/gpt-6-luna-build",
    ]) {
      const grokHome = await writeGrokSession(
        `grok-catalog-${model.replaceAll("/", "_")}`,
        null,
        {
          modelUsage: {
            [model]: {
              inputTokens: 1000,
              outputTokens: 200,
              cachedReadTokens: 400,
            },
          },
        },
      );
      const [document] = await scanDocuments("grok", pathsFor({ grokHome }));
      // 600 uncached input at $0.10, 400 cached at $0.01, 200 output at $0.50 per 1M.
      expect(document?.usageEvents[0]?.costUsd).toBeCloseTo(164e-6, 10);
      expect(document?.usageEvents[0]?.costComplete).toBe(true);
    }
  });

  test("leaves a turn unpriced when the catalog does not know the model", async () => {
    const grokHome = await writeGrokSession("grok-unknown", null, {
      modelUsage: {
        "grok-unlisted-build": { inputTokens: 1000, outputTokens: 200 },
      },
    });
    const [document] = await scanDocuments("grok", pathsFor({ grokHome }));
    expect(document?.usageEvents[0]?.costUsd).toBeNull();
    expect(document?.usageEvents[0]?.costComplete).toBe(false);
  });
});
